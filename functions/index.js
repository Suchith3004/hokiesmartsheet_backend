/**
 * Author: Suchith Suddala
 * Date: 11/4/2020
 * 
 */

//  Firebase functions
const functions = require('firebase-functions');

// Firebase Cloud Firestore
const admin = require('firebase-admin');
const serviceAccount = require('./sec7-firebase-service-account-key.json');

// Initialze application
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

//CORS
const cors = require('cors')({ origin: true });

const db = admin.firestore();
const courseCollection = db.collection('courses');
const checksheetCollection = db.collection('checksheets');
const resourcesCollection = db.collection('resources');
const userCollection = db.collection('users');
const organizationCollection = db.collection('organization');

const dbManager = require('./db-manager');


/**
 * Allows client to validate connection 
 */
exports.healthCheck = functions.https.onRequest((request, response) => {
    functions.logger.info("Hello logs!", { structuredData: true });
    cors(request, response, () => {
        return handleResponse(response, 200, "Health Check Successful")
    });
});




/**
 * --------------------------------------------------------------------------------------------------
 *                              CLIENT RESPONSE HANDLING
 * --------------------------------------------------------------------------------------------------
 */
/**
 * Converts a response, status, and error into a JSON response to be sent to client
 */
const handleError = (response, status, error) => {
    console.error(status, error);
    response.set('Access-Control-Allow-Origin', '*');
    response.set('Acess-Control-Allow-Methods', 'GET, PUT, POST, DELETE, OPTIONS')
    response.set('Access-Control-Allow-Headers', 'Content-Type, Access-Control-Allow-Headers, Authorization, X-Requested-With')

    return response.status(status).json(error);

};

/**
 * Converts a response, status, and body into a JSON response to be sent to client
 */
const handleResponse = (response, status, body) => {
    // console.log({
    //     Response: {
    //         Status: status,
    //         Body: body,
    //     },
    // });
    response.set('Access-Control-Allow-Origin', '*');
    response.set('Acess-Control-Allow-Methods', 'GET, PUT, POST, DELETE, OPTIONS')
    response.set('Access-Control-Allow-Headers', 'Content-Type, Access-Control-Allow-Headers, Authorization, X-Requested-With')
    if (body) {
        return response.status(200).json(body);
    }
    return response.sendStatus(status);
};



/**
 * --------------------------------------------------------------------------------------------------
 *                              INITIALIZING DATABASE
 * --------------------------------------------------------------------------------------------------
 */

/**
 * Initializes the database by loading in all static data. 
 */
exports.initializeDB = functions.https.onRequest(async(request, response) => {

    await dbManager.loadStaticData()
        .then(function() {
            return handleResponse(response, 200, "Success!");
        })
        .catch(function(error) {
            return handleError(response, 500, error);
        })

});

/**
 * Loads all the courses, checksheets, and pathways into the db
 */
exports.loadResources = functions.firestore
    .document('resources/static')
    .onCreate(async() => {
        // Initialize and load database
        console.log("Initializing database...");
        await dbManager.loadDbCourses()
            .catch(function(error) {
                console.log("Failed to load courses", error);
            });

        await dbManager.loadDbChecksheets()
            .catch(function(error) {
                console.log("Failed to load checksheets", error);
            });

        await dbManager.loadDbPathways()
            .catch(function(error) {
                console.log("Failed to load pathways", error);
            });

        await organizationCollection.doc("VirginiaTech").set({
            name: "Virginia Tech",
            school: "Virginia Tech",
            representatives: {},
            description: "Students that belong to the unversity."
        })

        console.log("Database initialized and loaded...");

    });




/**
 * --------------------------------------------------------------------------------------------------
 *                              USER FUNCTIONS
 * --------------------------------------------------------------------------------------------------
 */
/**
 * Creates a user with the appropriate changes based on completed AP classes and Transfer classes.
 */
exports.createUser = functions.https.onRequest(async(request, response) => {

    cors(request, response, async() => {

        //TODO: Check for empty strings
        if (!(request.body.firstName && request.body.lastName && request.body.userId && request.body.major && request.body.gradYear && request.body.apEquivalents && request.body.transferCredits))
            return handleError(response, 400, "Not all parameters provided");

        const userId = request.body.userId;
        const checksheetId = request.body.major + '-' + request.body.gradYear;

        //TODO: Seperate so that checksheets for user are stored in their own collection 
        //TODO: ADD PLAN

        // Check if the user already exists
        await userCollection.doc(userId).get()
            .then(doc => {
                if (doc.exists)
                    return handleError(response, 400, "User " + userId + " already exists.");
            })
            .catch(error => {
                return handleError(response, 500, error.message);
            })

        //Retrieve checksheet for major and grad year
        const checksheetDoc = await checksheetCollection.doc(checksheetId).get()
            .catch(error => {
                return handleError(response, 500, "Failed to retrieve checksheet: " + checksheetId + " ." + error);
            })

        //Duplicate checksheet for user (without semesters collection)
        if (checksheetDoc.exists) {
            const userChecksheet = checksheetDoc.data();
            userChecksheet.userId = userId;
            userChecksheet.firstName = request.body.firstName;
            userChecksheet.lastName = request.body.lastName;
            // userChecksheet.homlessCourses = [];
            userChecksheet.mentors = {};
            userChecksheet.mentorRequests = {};

            userChecksheet.apEquivalents = [];
            userChecksheet.transferCourses = [];

            await userCollection.doc(userId).set(userChecksheet)
                .catch(error => {
                    return handleError(response, 500, "Failed to create user. " + error.message);
                })
        } else {
            return handleError(response, 400, "Checksheet" + checksheetId + "doesn't exist.");
        }

        // Update use checksheet to adjust for AP/IB classes (only AP right now)
        const userSheetRef = await userCollection.doc(userId).get()
            .catch(error => {
                return handleError(response, 500, error);
            })

        const userChecksheet = userSheetRef.data();

        //Duplicate semester collection in user with added completion fields
        const semSnapshot = await checksheetCollection.doc(checksheetId).collection('semesters').get()
            .catch(error => {
                return handleError(response, 500, "Failed to retrieve checksheet: " + checksheetId + " ." + error);
            });

        for (const semDoc of semSnapshot.docs) {
            const semester = semDoc.data();
            semester.courseReferences = [];

            const coursesToRemove = [];
            semester.semesterCourses.forEach((course, i) => {

                semester.semesterCourses[i].pathway = course.courseId.includes('Pathway') || userChecksheet.pathwayIds.includes(course.courseId);

                // Check if credit is recieved through transfer credit
                if (request.body.transferCredits.includes(course.courseId)) {
                    userChecksheet.transferCourses.push(course);
                    coursesToRemove.push(i);
                    semester.totalCredits -= course.credits;
                    semester.semesterCourses[i].completed = true;
                } else {
                    // add course to references
                    semester.courseReferences.push(course.courseId);
                    semester.semesterCourses[i].completed = false;
                }

            });

            //Remove all transfer courses from the semester
            coursesToRemove.forEach((index) => {
                semester.semesterCourses.splice(index, 1);
            })

            // Add semester to user checksheet collection
            await userCollection.doc(userId).collection('semesters').doc(semDoc.id).set(semester)
                .catch(error => {
                    return handleError(response, 500, error);
                })
        }



        //Update all semesters to include completion status and ap/ib equivalent used. (currently only ap)
        const equivalentIds = request.body.apEquivalents;
        for (const equivalentId of equivalentIds) {

            // Retrieve matching ap equivalent from the backend
            var staticRef = await resourcesCollection.doc('static').get()
                .catch(function(error) {
                    return handleError(response, 500, error);
                });

            if (!staticRef.exists) {
                return handleError(response, 500, 'No static resources exist.');
            }

            const updatedEquivalent = staticRef.data().apEquivalents[equivalentId];
            updatedEquivalent.used = false;
            updatedEquivalent.pathway = false;

            // Look for matching course within users' checksheet
            var querySnapshot = await userCollection.doc(userId).collection('semesters')
                .where('courseReferences', 'array-contains', updatedEquivalent.vtCourseId).get()
                .catch(function(error) {
                    return handleError(response, 500, error);
                });

            if (!querySnapshot.empty) {
                // Remove course from semester if satisfied by ap credit
                const updatedSemester = querySnapshot.docs[0].data();
                const courseId = updatedEquivalent.vtCourseId;

                for (const course of updatedSemester.semesterCourses) {
                    if (course.courseId === courseId) {

                        updatedEquivalent.used = true;
                        const courseIndex = updatedSemester.courseReferences.indexOf(courseId);
                        updatedEquivalent.pathway = updatedSemester.semesterCourses[courseIndex].pathway;
                        updatedSemester.courseReferences.splice(courseIndex, 1);
                        updatedSemester.semesterCourses.splice(courseIndex, 1);
                        updatedSemester.totalCredits -= course.credits;

                        await userCollection.doc(userId).collection('semesters').doc('Semester ' + updatedSemester.semNum).set(updatedSemester)
                            .catch(error => {
                                return handleError(response, 500, error);
                            });

                        break;
                    }
                }
            }

            // Add AP class to list within user checksheet
            userChecksheet.apEquivalents.push(updatedEquivalent);
        }

        // Update the ap equivalents for the user checksheet
        await userCollection.doc(userId).set(userChecksheet, { merge: true })
            .catch(error => {
                return handleError(response, 500, error);
            })

        // Return the newly created user checksheet
        await userCollection.doc(userId).get()
            .then(async function(doc) {
                const cleanedSheet = doc.data();
                cleanedSheet.semesters = [];
                const snapshot = await userCollection.doc(userId).collection('semesters').get();
                snapshot.forEach(semester => {

                    const currSem = semester.data();
                    delete currSem.courseReferences;
                    cleanedSheet.semesters.push(currSem);
                });

                return handleResponse(response, 200, cleanedSheet);
            })
            .catch(error => {
                return handleError(response, 500, error);
            })
    });

});

/**
 * Retrieves the checksheet of a user
 */
exports.getUserChecksheet = functions.https.onRequest(async(request, response) => {
    cors(request, response, async() => {

        const userId = request.path.replace('/', '');

        await userCollection.doc(userId).get()
            .then(async function(doc) {
                if (doc.exists) {
                    const cleanedSheet = doc.data();
                    cleanedSheet.semesters = [];
                    const snapshot = await userCollection.doc(userId).collection('semesters').get();
                    snapshot.forEach(semester => {

                        const currSem = semester.data();
                        delete currSem.courseReferences;
                        cleanedSheet.semesters.push(currSem);
                    });
                    return handleResponse(response, 200, cleanedSheet);
                }
                return handleError(response, 400, "User doesn't exist.");
            })
            .catch(function(error) {
                return handleError(response, 500, "Failed to retrieve checksheet. " + error);
            })
    });

});

/**
 * Moves a class from one semester to another if the prerequisites and co requisites have been met
 */
exports.moveClass = functions.https.onRequest(async(request, response) => {
    cors(request, response, async() => {

        //TODO: Add check to ensure semester numbers given are within limits
        const userId = request.body.userId
        const courseId = request.body.courseId;
        const fromSem = request.body.fromSem;
        const toSem = request.body.toSem;

        if (courseId === undefined || fromSem === undefined || toSem === undefined || userId === undefined)
            return handleError(response, 400, "Missing body parameters.");

        // Retrieve user checksheet from db
        const userSheetRef = await userCollection.doc(userId).get()
            .catch(function(error) {
                return handleError(response, 500, error);
            });

        if (!userSheetRef.exists)
            return handleError(response, 400, "User (" + userId + ") doesn't exist in the db.");

        const userChecksheet = userSheetRef.data();

        // Check if course exists in origin semester
        const courseRef = await userCollection.doc(userId).collection('semesters').doc('Semester ' + fromSem).get()
            .catch(error => {
                return handleError(response, 500, error);
            })

        if (courseRef.exists) {
            const courses = courseRef.data().courseReferences
            if (!courses.includes(courseId))
                return handleError(response, 400, 'Course ' + courseId + ' does not exisit in semester ' + fromSem);
        } else {
            return handleError(response, 400, 'Semester ' + fromSem + 'does not exist in db.');
        }

        // Return parameters init
        const moveStatus = {
            prerequisites: false,
            corequisites: false,
            dependents: false
        }

        // If pathway or elective it can be immediately moved
        if (courseId.includes('Pathway') || courseId.includes('Elective')) {
            await this.internalMoveCourse(toSem, fromSem, courseId, userId)
                .catch(error => {
                    return handleError(response, 500, error);
                });

            moveStatus.prerequisites = true;
            moveStatus.corequisites = true;

            return handleResponse(response, 200, moveStatus);
        }

        // Retrieve full course data from db
        const courseToMoveRef = await courseCollection.doc(courseId).get()
            .catch(function(error) {
                return handleError(response, 500, error);
            });

        if (!courseToMoveRef.exists)
            return handleError(response, 400, "Course " + courseId + " doesn't exist in the db.");

        const courseToMove = courseToMoveRef.data();


        // Check to ensure all prerequisites and co requisites are met
        const preReqs = courseToMove.prerequisites;
        const coReqs = courseToMove.corequisites;
        const dependentCourses = [];

        for (var i = 1; i <= toSem; i++) {

            var semester;
            // Retrieve semester
            const semesterDoc = await userCollection.doc(userId).collection('semesters').doc('Semester ' + i).get()
                .catch(error => {
                    return handleError(response, 500, error);
                })

            if (semesterDoc.exists) {
                semester = semesterDoc.data()
            } else {
                return handleError(response, 500, 'Semester not found.')
            }

            // Check pre-reqs
            for (const preReq of preReqs) {
                // Seperate the prerequisties that include 'or'
                const seperatedReqs = preReq.split('|');

                // Remove course from pre-reqs and co-reqs if it has been met by AP or IB classes
                //TODO: IB classes
                userChecksheet.apEquivalents.forEach(equivalent => {
                    if (seperatedReqs.includes(equivalent.vtCourseId))
                        preReqs.splice(preReqs.indexOf(preReq), 1);
                })

                // Remove course from pre-reqs and co-reqs if it has been met by Transfer Courses
                userChecksheet.transferCourses.forEach(course => {

                    if (seperatedReqs.includes(course.courseId))
                        preReqs.splice(preReqs.indexOf(preReq), 1);
                });

                // Remove course from pre-reqs if it is taken in the semester before destination
                semester.courseReferences.forEach(id => {
                    if (i !== toSem) {
                        if (seperatedReqs.includes(id))
                            preReqs.splice(preReqs.indexOf(preReq), 1);
                    }
                });

            }

            // Check co-reqs
            for (const coReq of coReqs) {
                // Seperate the coRequisties that include 'or'
                const seperatedReqs = coReq.split('|');

                // Remove course from pre-reqs and co-reqs if it has been met by AP or IB classes
                //TODO: IB classes
                userChecksheet.apEquivalents.forEach(equivalent => {
                    if (seperatedReqs.includes(equivalent.vtCourseId))
                        coReqs.splice(coReqs.indexOf(coReq), 1);
                })

                // Remove course from pre-reqs and co-reqs if it has been met by Transfer Courses
                userChecksheet.transferCourses.forEach(course => {

                    if (seperatedReqs.includes(course.courseId))
                        coReqs.splice(coReqs.indexOf(coReq), 1);
                });

                // Remove course from pre-reqs if it is taken in the semester before destination
                semester.courseReferences.forEach(id => {
                    if (seperatedReqs.includes(id))
                        coReqs.splice(coReqs.indexOf(coReq), 1);
                });

            }

            if (i > fromSem) {
                //If course is being moved up in semesters (toSem > fromSem)
                //TODO: add force move and account for OR's
                for (const currCourse of semester.courseReferences) {

                    const courseRef = await courseCollection.doc(currCourse).get()
                        .catch(error => {
                            return handleError(response, 500, error);
                        });

                    if (courseRef.exists) {
                        const course = courseRef.data();

                        if (course.prerequisites) {
                            course.prerequisites.forEach(req => {
                                if (req.includes(courseId)) {

                                    moveStatus.dependents = true;
                                    dependentCourses.push(currCourse);
                                }
                            });
                        }
                        if (course.corequisites) {
                            course.corequisites.forEach(req => {
                                if (req.includes(courseId)) {
                                    moveStatus.dependents = true;
                                    dependentCourses.push(currCourse);
                                }
                            });
                        }
                    } else {
                        console.log(currCourse + " does not exists.");
                    }

                }
            }
        }

        // If all pre-requisites and co-requisites have been met, move the course
        if (preReqs.length === 0)
            moveStatus.prerequisites = true;

        if (coReqs.length === 0)
            moveStatus.corequisites = true;

        moveStatus.preReqsNotMet = (preReqs.length) ? preReqs : "N/A";
        moveStatus.coReqsNotMet = (coReqs.length) ? coReqs : "N/A";
        moveStatus.dependentCourses = (dependentCourses.length) ? dependentCourses : "N/A";

        if (moveStatus.prerequisites && moveStatus.corequisites && !moveStatus.dependents) {
            await this.internalMoveCourse(toSem, fromSem, courseId, userId)
                .then(() => {

                    return handleResponse(response, 200, moveStatus);
                })
                .catch(error => {
                    return handleError(response, 500, error);
                });
        } else {
            return handleResponse(response, 200, moveStatus);
        }

    });

});

/**
 * Moves the course with courseId from fromSem to toSem for the specified user.
 */
this.internalMoveCourse = async(toSem, fromSem, courseId, userId) => {

    const fromSemId = 'Semester ' + fromSem;
    const toSemId = 'Semester ' + toSem;

    const fromSemRef = await userCollection.doc(userId).collection('semesters').doc(fromSemId).get()
        .catch(error => {
            throw new Error(error);
        });

    if (!fromSemRef.exists)
        throw new Error(fromSem + ' does not exist in user checksheet');

    const toSemRef = await userCollection.doc(userId).collection('semesters').doc(toSemId).get()
        .catch(error => {
            throw new Error(error);
        });

    if (!toSemRef.exists)
        throw new Error(toSem + ' does not exist in user checksheet');

    const fromSemester = fromSemRef.data();
    const toSemester = toSemRef.data();

    // Remove from the origin semester
    const courseIndex = fromSemester.courseReferences.indexOf(courseId);
    fromSemester.courseReferences.splice(courseIndex, 1);
    const course = fromSemester.semesterCourses[courseIndex];
    fromSemester.semesterCourses.splice(courseIndex, 1);
    fromSemester.totalCredits -= course.credits;

    //Add to the destination semester
    toSemester.courseReferences.push(courseId);
    toSemester.semesterCourses.push(course);
    toSemester.totalCredits += course.credits;

    // Update both semesters in db

    if (fromSemester.totalCredits === 0) { // If the origin semester is now empty, delete it
        await userCollection.doc(userId).collection('semesters').doc(fromSemId).delete()
            .catch(error => {
                throw new Error(error);
            })
    } else { // update origin semester if not empty
        await userCollection.doc(userId).collection('semesters').doc(fromSemId).set(fromSemester)
            .catch(error => {
                throw new Error(error);
            });
    }

    // Update destination semester
    await userCollection.doc(userId).collection('semesters').doc(toSemId).set(toSemester)
        .catch(error => {
            throw new Error(error);
        });

}



/**
 * --------------------------------------------------------------------------------------------------
 *                              COURSE FUNCTIONS
 * --------------------------------------------------------------------------------------------------
 */
/**
 * Returns a course with the name of the prefix
 */
exports.getCourseByPrefix = functions.https.onRequest(async(request, response) => {
    cors(request, response, async() => {

        const category = request.query.category;
        const number = request.query.number;

        if (category === undefined)
            return handleError(response, 400, "Course category not provided (undefined).")

        if (number === undefined)
            return handleError(response, 400, "Course category not provided (undefined).")

        const coursePrefix = category.toUpperCase() + '-' + number;

        const courseRef = await courseCollection.doc(coursePrefix).get();

        if (courseRef.exists) {
            return handleResponse(response, 200, courseRef.data());
        } else {
            return handleError(response, 400, 'Course not found: ' + coursePrefix);
        }

    });

});

/**
 * Returns a list of courses that start with the category prefix and/or number prefix of course provided
 */
exports.autocompleteCoursePrefix = functions.https.onRequest(async(request, response) => {
    cors(request, response, async() => {

        const category = request.query.category;
        const number = request.query.number;

        if (category === undefined)
            return handleError(response, 400, "Course category not provided (undefined).")

        if (category === '')
            return handleResponse(response, 200, []);

        if (number !== undefined && number !== '') {
            await dbManager.autocompleteSearchSecond(courseCollection, 'category', category, 'number', number)
                .then(function(queryResult) {
                    const cleanedCourses = [];
                    queryResult.forEach(course => {
                        cleanedCourses.push({
                            abbreviation: course.category + '-' + course.number,
                            name: course.name
                        })
                    })
                    return handleResponse(response, 200, cleanedCourses);
                })
                .catch(function(error) {
                    return handleError(response, 400, error);
                });
        } else { //just category
            await dbManager.autocompleteSearch(courseCollection, 'category', category)
                .then(function(queryResult) {
                    const cleanedCourses = [];
                    queryResult.forEach(course => {
                        cleanedCourses.push({
                            abbreviation: course.category + '-' + course.number,
                            name: course.name
                        })
                    })
                    return handleResponse(response, 200, cleanedCourses);
                })
                .catch(function(error) {
                    return handleError(response, 400, error);
                });
        }
    });

});

/**
 * Returns a course using the name of the course
 */
exports.getCourseByName = functions.https.onRequest(async(request, response) => {
    cors(request, response, async() => {

        const courseName = (request.path).replace('/', '');

        if (courseName === undefined)
            return handleError(response, 400, "Course name not provided (undefined).");

        const courseRef = await courseCollection.doc(courseName).get();

        if (courseRef.exists)
            return handleResponse(response, 200, courseRef.data());
        else
            return handleError(response, 400, 'Course not found: ' + courseName);
    });

});

/**
 * Returns a list of courses that start with the course name prefix provided
 */
exports.autocompleteCourseName = functions.https.onRequest(async(request, response) => {
    cors(request, response, async() => {

        const courseName = (request.path).replace('/', '');

        if (courseName === undefined)
            return handleError(response, 400, "Course name not provided (undefined).");


        await dbManager.autocompleteSearch(courseCollection, 'name', courseName)
            .then(function(queryResult) {
                const cleanedCourses = [];
                queryResult.forEach(course => {
                    cleanedCourses.push({
                        abbreviation: course.category + '-' + course.number,
                        name: course.name
                    })
                })
                return handleResponse(response, 200, cleanedCourses);
            })
            .catch(function(error) {
                return handleError(response, 400, error);
            });

    });

});


/**
 * --------------------------------------------------------------------------------------------------
 *                              STATIC RESOURCES FUNCTIONS
 * --------------------------------------------------------------------------------------------------
 */

/**
 * Retrieves a list of all supported majors at VT
 */
exports.getAllMajors = functions.https.onRequest(async(request, response) => {
    cors(request, response, async() => {

        await resourcesCollection.doc('static').get()
            .then(function(doc) {
                if (doc.exists)
                    return handleResponse(response, 200, doc.data().majors);
                else
                    return handleError(response, 400, "static resources do not exist.");
            })
            .catch(function(error) {
                return handleError(response, 500, error);
            });
    });

});

/**
 * Returns a list of all AP equivalents
 */
exports.getAllAPEquivalents = functions.https.onRequest(async(request, response) => {
    cors(request, response, async() => {

        await resourcesCollection.doc('static').get()
            .then(function(doc) {
                if (doc.exists)
                    return handleResponse(response, 200, doc.data().apEquivalents);
                else
                    return handleError(response, 400, "static resources do not exist.");
            })
            .catch(function(error) {
                return handleError(response, 500, error);
            });
    });

});

/**
 * Retrieves a list of all supported schools at VT
 */
exports.getAllSchools = functions.https.onRequest(async(request, response) => {
    cors(request, response, async() => {

        await resourcesCollection.doc('static').get()
            .then(function(doc) {
                if (doc.exists) {
                    const schools = [];
                    const schoolsRef = doc.data().schools;
                    for (var key in schoolsRef)
                        schools.push(key);

                    return handleResponse(response, 200, schools);
                } else
                    return handleError(response, 400, "Schools does not exist.");
            })
            .catch(function(error) {
                return handleError(response, 500, error);
            });

    });

});

/**
 * Retrieves a list of all supported schools at VT
 */
exports.getAllPathways = functions.https.onRequest(async(request, response) => {
    cors(request, response, async() => {

        await resourcesCollection.doc('static').get()
            .then(function(doc) {
                if (doc.exists)
                    return handleResponse(response, 200, doc.data().pathways);
                else
                    return handleError(response, 400, "Pathways does not exist.");
            })
            .catch(function(error) {
                return handleError(response, 500, error);
            });

    });

});



/**
 * --------------------------------------------------------------------------------------------------
 *                              CHECKSHEET FUNCTIONS
 * --------------------------------------------------------------------------------------------------
 */
/**
 * Retrieves the default checksheet given a major and graduation year
 */
exports.getDefaultChecksheet = functions.https.onRequest(async(request, response) => {
    cors(request, response, async() => {

        const year = request.query.gradYear;
        const major = request.query.major;

        if (year === undefined)
            return handleError(response, 400, 'Year not provided');
        if (major === undefined)
            return handleError(response, 400, 'Major not provided');

        const checksheetId = major.toUpperCase() + '-' + year;
        await checksheetCollection.doc(checksheetId).get()
            .then(async function(doc) {
                if (doc.exists) {

                    const cleanedSheet = doc.data();
                    cleanedSheet.semesters = [];
                    const snapshot = await checksheetCollection.doc(checksheetId).collection('semesters').get();
                    snapshot.forEach(semester => {
                        cleanedSheet.semesters.push(semester.data());
                    });

                    return handleResponse(response, 200, cleanedSheet);

                } else
                    return handleError(response, 400, "Checksheet does not exist.");
            })
            .catch(function(error) {
                return handleError(response, 500, error);
            })
    });

});




/**
 * --------------------------------------------------------------------------------------------------
 *                              MENTORING FUNCTIONS
 * --------------------------------------------------------------------------------------------------
 */

/**
 * Creates a mentor if they do not already exist as a student
 */
exports.createMentor = functions.https.onRequest(async(request, response) => {

    cors(request, response, async() => {

        const mentorId = request.body.userId;
        const firstName = request.body.firstName;
        const lastName = request.body.lastName;
        const organizationId = request.body.organizationId;
        const occupation = request.body.occupation;
        const description = request.body.description;
        const alumni = request.body.alumni;
        const qualities = request.body.qualities;
        const hobbies = request.body.hobbies;
        const mentorInterests = request.body.mentorInterests;

        if (!(mentorId && firstName && lastName && organizationId && occupation && description && qualities && hobbies && mentorInterests && alumni))
            return handleError(response, 400, "One or more body parameters are missing!");

        // Check if the mentor already exists
        await userCollection.doc(mentorId).get()
            .then(doc => {
                if (doc.exists)
                    return handleError(response, 400, "Mentor " + mentorId + " already exists!");
            })
            .catch(error => {
                return handleError(response, 500, error);
            })

        // Check if the organization exists
        const organizationDoc = await organizationCollection.doc(organizationId).get()
            .catch(error => {
                return handleError(response, 500, error);
            })

        if (!organizationDoc.exists)
            return handleError(response, 400, "Organization " + organizationId + " does not exist.");

        const organization = organizationDoc.data();

        const mentor = {
            isMentor: true,
            firstName: firstName,
            lastName: lastName,
            organizationId: organizationId,
            organizationName: organization.name,
            occupation: occupation,
            description: description,
            alumni: alumni,
            qualities: qualities,
            hobbies: hobbies,
            mentorInterests: mentorInterests,
            requests: {},
            mentees: {}
        }

        await userCollection.doc(mentorId).set(mentor)
            .then(() => {
                return handleResponse(response, 200, mentor);
            })
            .catch(error => {
                return handleError(response, 500, "Failed to add mentor " + mentorId + ". " + error.message);
            })

    })

});
//TODO: Make all errors more specific.

exports.getAllUserMentees = functions.https.onRequest(async(request, response) => {

    cors(request, response, async() => {

        const userId = request.body.userId;

        const userDoc = await userCollection.doc(userId).get()
            .catch(error => {
                return handleError(response, 500, error);
            })

        if(userDoc.data().mentees) {
            return handleResponse(response, 200, userDoc.data().mentees);
        }else {
            return handleResponse(response, 500);
        }

    });
    
});

exports.getAllUserMentors = functions.https.onRequest(async(request, response) => {

    cors(request, response, async() => {

        const userId = request.body.userId;

        const userDoc = await userCollection.doc(userId).get()
            .catch(error => {
                return handleError(response, 500, error);
            })

        if(userDoc.data().mentors) {
            return handleResponse(response, 200, userDoc.data().mentors);
        }else {
            return handleResponse(response, 500);
        }

    });
    
});

/**
 *  If a student is also mentor, then their profile is modfied to include their mentor information
 */
exports.addMentorToUser = functions.https.onRequest(async(request, response) => {

    cors(request, response, async() => {

        const userId = request.body.userId;
        const organizationId = request.body.organizationId;
        const description = request.body.description;
        const qualities = request.body.qualities;
        const hobbies = request.body.hobbies;
        const mentorInterests = request.body.mentorInterests;
        const clubs = request.body.clubs;
        const occupation = request.body.occupation;

        if (!(userId && organizationId && description && qualities && hobbies && mentorInterests && clubs))
            return handleError(response, 400, 'One or more query parameters are missing!');



        // Check if the user exists
        const userDoc = await userCollection.doc(userId).get()
            .catch(error => {
                return handleError(response, 500, error);
            })

        if (!userDoc.exists)
            return handleError(response, 400, "User " + userId + " does not exist");

        // Check if the organization exists
        await organizationCollection.doc(organizationId).get()
            .then(doc => {
                if (!doc.exists)
                    return handleError(response, 400, "Organization " + organizationId + " does not exist.");
            })
            .catch(error => {
                return handleError(response, 500, error);
            })
            // Add mentor status to user
        const user = userDoc.data();
        user.isMentor = true;
        user.organizationId = organizationId;
        user.description = description;
        user.requests = {};
        user.mentees = {};
        user.qualities = qualities;
        user.hobbies = hobbies;
        user.clubs = clubs;
        user.mentorInterests = mentorInterests;
        user.occupation = occupation;

        await userCollection.doc(userId).set(user)
            .then(() => {
                return handleResponse(response, 200, user);
            })
            .catch(error => {
                return handleError(response, 500, error);
            })

    })

})

/**
 * Creates a mentor organization 
 */
exports.createMentorOrganization = functions.https.onRequest(async(request, response) => {

    cors(request, response, async() => {

        const name = request.body.name;
        const school = request.body.school;
        const representatives = request.body.representatives;
        const description = request.body.description;

        if (!(school && representatives && name && description))
            return handleError(response, 400, "One or more of the required body parameters are missing!");

        // Check if the organization exists
        await organizationCollection.where(name, '==', name).get()
            .then(doc => {
                if (doc.exists)
                    return handleError(response, 400, "Organization " + name + " already exists!");
            })
            .catch(error => {
                return handleError(response, 500, error);
            })

        const organization = {
            name: name,
            school: school,
            representatives: representatives,
            description: description
        };

        await organizationCollection.add(organization)
            .then(() => {
                return handleResponse(response, 200, organization);
            })
            .catch(error => {
                return handleError(response, 500, error);
            })
    })

})

/**
 * Adds a mentee to mentor
 */
exports.sendMenteeRequest = functions.https.onRequest(async(request, response) => {

    cors(request, response, async() => {

        const menteeId = request.body.menteeId;
        const mentorId = request.body.mentorId;

        if (!(menteeId && mentorId))
            return handleError(response, 400, "One or more of the required body parameters are missing!");

        // Check if mentor exists
        const mentorDoc = await userCollection.doc(mentorId).get()
            .catch(error => {
                return handleError(response, 500, error);
            })

        if (!mentorDoc.exists)
            return handleError(response, 400, "Mentor " + mentorId + " does not exist!");

        // Check if user is actually a mentor
        const mentor = mentorDoc.data();
        if (!mentor.isMentor)
            return handleError(response, 400, "Mentor " + mentorId + " is not a mentor!");


        // Check if mentee exists
        const menteeDoc = await userCollection.doc(menteeId).get()
            .catch(error => {
                return handleError(response, 500, error);
            })

        if (!menteeDoc.exists)
            return handleError(response, 400, "Mentee " + mentorId + " does not exist.");
        const mentee = menteeDoc.data();

        //Check if mentee already has the same mentor
        if (mentee.mentors[mentorId])
            return handleError(response, 400, mentorId + " is already a mentor of mentee " + menteeId);


        // Update both mentee and mentor requests
        mentor.requests[menteeId] = "RECIEVED";
        mentee.mentorRequests[mentorId] = "SENT";

        await userCollection.doc(mentorId).set(mentor)
            .catch(error => {
                return handleError(response, 500, error);
            })

        await userCollection.doc(menteeId).set(mentee)
            .then(() => {
                return handleResponse(response, 200);
            })
            .catch(error => {
                return handleError(response, 500, error);
            })

    })

})

/**
 * Updates the response to a request from amentee
 */
exports.respondToMenteeRequest = functions.https.onRequest(async(request, response) => {

    cors(request, response, async() => {

        const menteeId = request.body.menteeId;
        const mentorId = request.body.mentorId;
        const result = request.body.response;

        if (!(menteeId && mentorId && result !== undefined))
            return handleError(response, 400, "One or more of the required body parameters are missing!");

        // Check if mentor exists
        const mentorDoc = await userCollection.doc(mentorId).get()
            .catch(error => {
                return handleError(response, 500, error);
            })

        if (!mentorDoc.exists)
            return handleError(response, 400, "Mentor " + mentorId + " does not exist!");

        // Check if user is actually a mentor
        const mentor = mentorDoc.data();
        if (!mentor.isMentor)
            return handleError(response, 400, "Mentor " + mentorId + " is not a mentor!");

        // Check if mentor has a request from mentee
        if (!mentor.requests[menteeId])
            return handleError(response, 400, "Mentor " + mentorId + " does not have a request from " + menteeId);


        // Check if mentee exists
        const menteeDoc = await userCollection.doc(menteeId).get()
            .catch(error => {
                return handleError(response, 500, error);
            })

        if (!menteeDoc.exists)
            return handleError(response, 400, "Mentee " + mentorId + " does not exist.");
        const mentee = menteeDoc.data();

        //Check if mentee has a request to the mentor
        if (!mentee.mentorRequests[mentorId])
            return handleError(response, 400, "Request for mentor " + mentorId + " does not exist.");

        // Update requests to reflect response
        const mentorName = mentor.firstName + ' ' + mentor.lastName;
        const menteeName = mentee.firstName + ' ' + mentee.lastName;

        if (response) { // Accepted
            delete mentor.requests[menteeId];
            delete mentee.mentorRequests[mentorId];

            mentor.mentees[menteeId] = menteeName;
            mentee.mentors[mentorId] = mentorName;
        } else {
            delete mentor.requests[menteeId];
            mentee.mentorRequests[mentorId] = 'DECLINED';
        }

        await userCollection.doc(mentorId).set(mentor)
            .catch(error => {
                return handleError(response, 500, error);
            })

        await userCollection.doc(menteeId).set(mentee)
            .then(() => {
                return handleResponse(response, 200);
            })
            .catch(error => {
                return handleError(response, 500, error);
            })

    })

})


/**
 * Returns all mentors available
 */
exports.getAllMentors = functions.https.onRequest(async(request, response) => {

    cors(request, response, async() => {

        await userCollection.where('isMentor', '==', true).get()
            .then(function(querySnapshot) {
                const mentors = [];
                querySnapshot.forEach(function(doc) {
                    const mentor = doc.data();
                    const cleanedMentor = {
                        mentorId: mentor.id,
                        name: mentor.firstName + ' ' + mentor.lastName,
                        organizationName: mentor.organizationName,
                        occupation: mentor.occupation,
                        description: mentor.description,
                        vtAlumni: mentor.vtAlumni
                    }
                    mentors.push(cleanedMentor);
                })

                handleResponse(response, 200, mentors);
            })
            .catch(error => {
                return handleError(response, 500, error);
            })

    })

})


/**
 * Returns all mentor organizations that are supported
 */
exports.getAllOrganizations = functions.https.onRequest(async(request, response) => {

    cors(request, response, async() => {

        await organizationCollection.get()
            .then(function(querySnapshot) {
                const organizations = [];
                querySnapshot.forEach(function(doc) {
                    const org = doc.data();
                    org.id = doc.id
                    organizations.push(org);
                })

                return handleResponse(response, 200, organizations);
            })
            .catch(error => {
                return handleError(response, 500, error);
            })

    })

})


/**
 * Returns all mentors in affiliated with a given organization
 */
exports.getAllMentorsInOrganization = functions.https.onRequest(async(request, response) => {

    cors(request, response, async() => {

        const organizationId = request.params.organizationId;
        if (!organizationId)
            return handleError(response, 400, 'Oranization id ' + organizationId + ' is missing!');

        await organizationCollection.doc(organizationId).get()
            .then(doc => {
                if (!doc.exists)
                    return handleError(response, 400, 'Oranization id ' + organizationId + ' not valid!');
            })
            .catch(error => {
                return handleError(response, 500, error);
            })

        await userCollection
            .where('isMentor', '==', true)
            .where('oraganizationId', '==', organizationId)
            .get()
            .then(function(querySnapshot) {
                const mentors = [];
                querySnapshot.forEach(function(doc) {
                    const mentor = doc.data();
                    const cleanedMentor = {
                        mentorId: mentor.id,
                        name: mentor.firstName + ' ' + mentor.lastName,
                        organizationName: mentor.organizationName,
                        occupation: mentor.occupation,
                        description: mentor.description,
                        vtAlumni: mentor.vtAlumni
                    }
                    mentors.push(cleanedMentor);
                })

                handleResponse(response, 200, mentors);
            })
            .catch(error => {
                return handleError(response, 500, error);
            })

    })

})