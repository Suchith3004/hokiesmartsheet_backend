/**
 * Author: Suchith Suddala
 * Date: 11/4/2020
 * 
 */

//  Firebase functions
const functions = require('firebase-functions');

// Firebase Cloud Firestore
const admin = require('firebase-admin');
const serviceAccount = require('../sec7-firebase-service-account-key.json');

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

const dbManager = require('./db-manager');
const dataCleaner = require('./data-cleaner');

// Response Handling
const handleError = (request, response, status, error) => {
    console.error(status, error);
    response.set('Access-Control-Allow-Origin', '*');
    response.set('Acess-Control-Allow-Methods', 'GET, PUT, POST, DELETE, OPTIONS')
    response.set('Access-Control-Allow-Headers', 'Content-Type, Access-Control-Allow-Headers, Authorization, X-Requested-With')
    return cors()(request, response, () => {
        console.log(request.body);
        response.status(status).json(error);
    });
};

const handleResponse = (request, response, status, body) => {
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


exports.healthCheck = functions.https.onRequest((request, response) => {
    functions.logger.info("Hello logs!", { structuredData: true });
    cors(request, response, () => {
        return handleResponse(request, response, 200, "Health Check Successful")
    });
});

//-----------------User Functions-------------------------------
/**
 * Creates a user with the appropriate changes based on completed AP classes and Transfer classes.
 */
exports.createUser = functions.https.onRequest(async (request, response) => {

    cors(request, response, async () => {

        if (request.body.firstName || request.body.lastName || request.body.userId === undefined || request.body.major === undefined || request.body.gradYear === undefined || request.body.apEquivalents === undefined || request.body.transferCredits === undefined)
            return handleError(request, response, 400, "Not all parameters provided");

        const userId = request.body.userId;
        const checksheetId = request.body.major + '-' + request.body.gradYear;

        //Retrieve checksheet for major and grad year
        const checksheetDoc = await checksheetCollection.doc(checksheetId).get()
            .catch(error => {
                return handleError(request, response, 500, "Failed to retrieve checksheet: " + checksheetId + " ." + error);
            })

        //Duplicate checksheet for user (without semesters collection)
        if (checksheetDoc.exists) {
            const userChecksheet = checksheetDoc.data();
            userChecksheet.userId = userId;
            userChecksheet.homlessCourses = [];

            userChecksheet.apEquivalents = [];
            userChecksheet.transferCourses = [];

            await userCollection.doc(userId).set(userChecksheet)
                .catch(error => {
                    return handleError(request, response, 500, "Failed to create user. " + error.message);
                })
        }
        else {
            return handleError(request, response, 400, "Checksheet" + checksheetId + "doesn't exist.");
        }

        // Update use checksheet to adjust for AP/IB classes (only AP right now)
        const userSheetRef = await userCollection.doc(userId).get()
            .catch(error => {
                return handleError(request, response, 500, error);
            })

        const userChecksheet = userSheetRef.data();

        //Duplicate semester collection in user with added completion fields
        const semSnapshot = await checksheetCollection.doc(checksheetId).collection('semesters').get()
            .catch(error => {
                return handleError(request, response, 500, "Failed to retrieve checksheet: " + checksheetId + " ." + error);
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
                }
                else {
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
                    return handleError(request, response, 500, error);
                })
        }



        //Update all semesters to include completion status and ap/ib equivalent used. (currently only ap)
        const equivalentIds = request.body.apEquivalents;
        for (const equivalentId of equivalentIds) {

            // Retrieve matching ap equivalent from the backend
            var staticRef = await resourcesCollection.doc('static').get()
                .catch(function (error) {
                    return handleError(request, response, 500, error);
                });

            if (!staticRef.exists) {
                return handleError(request, response, 500, 'No static resources exist.');
            }

            const updatedEquivalent = staticRef.data().apEquivalents[equivalentId];
            updatedEquivalent.used = false;
            updatedEquivalent.pathway = false;

            // Look for matching course within users' checksheet
            var querySnapshot = await userCollection.doc(userId).collection('semesters')
                .where('courseReferences', 'array-contains', updatedEquivalent.vtCourseId).get()
                .catch(function (error) {
                    return handleError(request, response, 500, error);
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
                                return handleError(request, response, 500, error);
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
                return handleError(request, response, 500, error);
            })

        // Return the newly created user checksheet
        await userCollection.doc(userId).get()
            .then(async function (doc) {
                const cleanedSheet = doc.data();
                cleanedSheet.semesters = [];
                const snapshot = await userCollection.doc(userId).collection('semesters').get();
                snapshot.forEach(semester => {

                    const currSem = semester.data();
                    delete currSem.courseReferences;
                    cleanedSheet.semesters.push(currSem);
                });

                return handleResponse(request, response, 200, cleanedSheet);
            })
            .catch(error => {
                return handleError(request, response, 500, error);
            })
    });

});

/**
 * Retrieves the checksheet of a user
 */
exports.getUserChecksheet = functions.https.onRequest(async (request, response) => {
    cors(request, response, async () => {

        const userId = request.path.replace('/', '');

        await userCollection.doc(userId).get()
            .then(async function (doc) {
                if (doc.exists) {
                    const cleanedSheet = doc.data();
                    cleanedSheet.semesters = [];
                    const snapshot = await userCollection.doc(userId).collection('semesters').get();
                    snapshot.forEach(semester => {

                        const currSem = semester.data();
                        delete currSem.courseReferences;
                        cleanedSheet.semesters.push(currSem);
                    });
                    return handleResponse(request, response, 200, cleanedSheet);
                }
                return handleError(request, response, 400, "User doesn't exist.");
            })
            .catch(function (error) {
                return handleError(request, response, 500, "Failed to retrieve checksheet. " + error);
            })
    });

});

/**
 * Moves a class from one semester to another if the prerequisites and co requisites have been met
 */
exports.moveClass = functions.https.onRequest(async (request, response) => {
    cors(request, response, async () => {

        //TODO: Add check to ensure semester numbers given are within limits
        const userId = request.body.userId
        const courseId = request.body.courseId;
        const fromSem = request.body.fromSem;
        const toSem = request.body.toSem;

        if (courseId === undefined || fromSem === undefined || toSem === undefined || userId === undefined)
            return handleError(request, response, 400, "Missing body parameters.");

        // Check if course exists in origin semester
        const courseRef = await userCollection.doc(userId).collection('semesters').doc('Semester ' + fromSem).get()
            .catch(error => {
                return handleError(request, response, 500, error);
            })

        if (courseRef.exists) {
            const courses = courseRef.data().courseReferences
            if (!courses.includes(courseId))
                return handleError(request, response, 400, 'Course ' + courseId + ' does not exisit in semester ' + fromSem);
        }
        else {
            return handleError(request, response, sem, 'Semester ' + fromSem + 'does not exist in db.');
        }

        // Return parameters init
        const moveStatus = {
            prerequisites: false,
            corequisites: false
        }

        // If pathway or elective it can be immediately moved
        if (courseId.includes('Pathway') || courseId.includes('Elective')) {
            await internalMoveCourse(toSem, fromSem, courseId, userId)
                .catch(error => {
                    return handleError(request, response, 500, error);
                });

            moveStatus.prerequisites = true;
            moveStatus.corequisites = true;

            return handleResponse(request, response, 200, moveStatus);
        }

        // Retrieve full course data from db
        const courseToMoveRef = await courseCollection.doc(courseId).get()
            .catch(function (error) {
                return handleError(request, response, 500, error);
            });

        if (!courseToMoveRef.exists)
            return handleError(request, response, 400, "Course " + courseId + " doesn't exist in the db.");

        const courseToMove = courseToMoveRef.data();

        // Retrieve user checksheet from db
        const userSheetRef = await userCollection.doc(userId).get()
            .catch(function (error) {
                return handleError(request, response, 500, error);
            });

        if (!userSheetRef.exists)
            return handleError(request, response, 400, "User (" + userId + ") doesn't exist in the db.");

        const userChecksheet = userSheetRef.data();

        // Check to ensure all prerequisites and co requisites are met
        const preReqs = courseToMove.prerequisites;
        const coReqs = courseToMove.corequisites;

        for (i = 1; i <= toSem; i++) {
            // Retrieve semester
            await userCollection.doc(userId).collection('semesters').doc('Semester ' + i).get()
                .then(async function (doc) {
                    const semester = doc.data();

                    // Remove course from pre-reqs and co-reqs if it has been met by AP or IB classes
                    //TODO: IB classes
                    userChecksheet.apEquivalents.forEach(equivalent => {

                        // Check pre-reqs
                        for (const preReq of preReqs) {
                            // Seperate the prerequisties that include 'or'
                            const seperatedReqs = preReq.split('|');
                            if (seperatedReqs.includes(equivalent.vtCourseId))
                                preReqs.splice(preReqs.indexOf(preReq), 1);
                        }

                        // Check co-reqs                    
                        if (coReqs.includes(equivalent.vtCourseId))
                            coReqs.splice(coReqs.indexOf(equivalent.id), 1);

                    })

                    semester.courseReferences.forEach(id => {

                        // Remove course from pre-reqs if it is taken in the semester before destination
                        if (i !== toSem) {
                            for (const preReq of preReqs) {
                                // Seperate the prerequisties that include 'or'
                                const seperatedReqs = preReq.split('|');
                                if (seperatedReqs.includes(id))
                                    preReqs.splice(preReqs.indexOf(preReq), 1);
                            }
                        }

                        // Remove course from co-reqs if it is taken in the destination semester of before
                        if (coReqs.includes(id))
                            coReqs.splice(coReqs.indexOf(id), 1);

                    });
                })
                .catch(error => {
                    return handleError(request, response, 500, error);
                })
        }

        // If all pre-requisites and co-requisites have been met, move the course
        if (preReqs.length === 0)
            moveStatus.prerequisites = true;

        if (coReqs.length === 0)
            moveStatus.corequisites = true;

        moveStatus.preReqsNotMet = preReqs;
        moveStatus.coReqsNotsMet = coReqs;

        if (moveStatus.prerequisites && moveStatus.corequisites) {
            await this.internalMoveCourse(toSem, fromSem, courseId, userId)
                .then(() => {

                    return handleResponse(request, response, 200, moveStatus);
                })
                .catch(error => {
                    return handleError(request, response, 500, error);
                });
        }
        else {
            return handleResponse(request, response, 200, moveStatus);
        }

    });

});

/**
 * Moves the course with courseId from fromSem to toSem for the specified user.
 */
this.internalMoveCourse = async (toSem, fromSem, courseId, userId) => {

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
    }
    else {  // update origin semester if not empty
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
 * Returns a course with the name of the prefix
 */
exports.getCourseByPrefix = functions.https.onRequest(async (request, response) => {
    cors(request, response, async () => {

        const category = request.query.category;
        const number = request.query.number;

        if (category === undefined)
            return handleError(request, response, 400, "Course category not provided (undefined).")

        if (number === undefined)
            return handleError(request, response, 400, "Course category not provided (undefined).")

        const coursePrefix = category.toUpperCase() + '-' + number;

        const courseRef = await courseCollection.doc(coursePrefix).get();

        if (courseRef.exists) {
            // const course = dataCleaner.cleanCourse(courseRef.data(), coursePrefix);
            return handleResponse(request, response, 200, courseRef.data());
        }
        else {
            return handleError(request, response, 400, 'Course not found: ' + coursePrefix);
        }

    });

});

/**
 * Returns a list of courses that start with the category prefix and/or number prefix of course provided
 */
exports.autocompleteCoursePrefix = functions.https.onRequest(async (request, response) => {
    cors(request, response, async () => {

        const category = request.query.category;
        const number = request.query.number;

        if (category === undefined)
            return handleError(request, response, 400, "Course category not provided (undefined).")

        if (category === '')
            return handleResponse(request, response, 200, []);

        if (number !== undefined || number === '') {
            await dbManager.autocompleteSearch(courseCollection, 'category', category, 'number', number)
                .then(function (queryResult) {
                    return handleResponse(request, response, 200, queryResult);
                })
                .catch(function (error) {
                    return handleError(request, response, 400, error);
                });
        }
        else { //just category
            await dbManager.autocompleteSearch(courseCollection, 'category', category)
                .then(function (queryResult) {
                    return handleResponse(request, response, 200, queryResult);
                })
                .catch(function (error) {
                    return handleError(request, response, 400, error);
                });
        }
    });

});

/**
 * Returns a course using the name of the course
 */
exports.getCourseByName = functions.https.onRequest(async (request, response) => {
    cors(request, response, async () => {

        const courseName = (request.path).replace('/', '');

        if (courseName === undefined)
            return handleError(request, response, 400, "Course name not provided (undefined).");

        const courseRef = await courseCollection.doc(courseName).get();

        if (courseRef.exists)
            return handleResponse(request, response, 200, courseRef.data());
        else
            return handleError(request, response, 400, 'Course not found: ' + courseName);
    });

});

/**
 * Returns a list of courses that start with the course name prefix provided
 */
exports.autocompleteCourseName = functions.https.onRequest(async (request, response) => {
    cors(request, response, async () => {

        const courseName = (request.path).replace('/', '');

        if (courseName === undefined)
            return handleError(request, response, 400, "Course name not provided (undefined).");


        await dbManager.autocompleteSearch(courseCollection, 'name', courseName)
            .then(function (queryResult) {
                return handleResponse(request, response, 200, queryResult);
            })
            .catch(function (error) {
                return handleError(request, response, 400, error);
            });

    });

});

/**
 * Retrieves a list of all supported majors at VT
 */
exports.getAllMajors = functions.https.onRequest(async (request, response) => {
    cors(request, response, async () => {

        await resourcesCollection.doc('static').get()
            .then(function (doc) {
                if (doc.exists)
                    return handleResponse(request, response, 200, doc.data().majors);
                else
                    return handleError(request, response, 400, "static resources do not exist.");
            })
            .catch(function (error) {
                return handleError(request, response, 500, error);
            });
    });

});

/**
 * Returns a list of all AP equivalents
 */
exports.getAllAPEquivalents = functions.https.onRequest(async (request, response) => {
    cors(request, response, async () => {

        await resourcesCollection.doc('static').get()
            .then(function (doc) {
                if (doc.exists)
                    return handleResponse(request, response, 200, doc.data().apEquivalents);
                else
                    return handleError(request, response, 400, "static resources do not exist.");
            })
            .catch(function (error) {
                return handleError(request, response, 500, error);
            });
    });

});

/**
 * Retrieves a list of all supported schools at VT
 */
exports.getAllSchools = functions.https.onRequest(async (request, response) => {
    cors(request, response, async () => {

        await resourcesCollection.doc('static').get()
            .then(function (doc) {
                if (doc.exists) {
                    const schools = [];
                    const schoolsRef = doc.data().schools;
                    for (var key in schoolsRef)
                        if (schoolsRef.hasOwnProperty(key))
                            schools.push(key);

                    return handleResponse(request, response, 200, schools);
                }
                else
                    return handleError(request, response, 400, "Schools does not exist.");
            })
            .catch(function (error) {
                return handleError(request, response, 500, error);
            });

    });

});

/**
 * Retrieves a list of all supported schools at VT
 */
exports.getAllPathways = functions.https.onRequest(async (request, response) => {
    cors(request, response, async () => {

        await resourcesCollection.doc('static').get()
            .then(function (doc) {
                if (doc.exists)
                    return handleResponse(request, response, 200, doc.data().pathways);
                else
                    return handleError(request, response, 400, "Pathways does not exist.");
            })
            .catch(function (error) {
                return handleError(request, response, 500, error);
            });

    });

});


// ----------------- Checksheet Functions ------------------
exports.getDefaultChecksheet = functions.https.onRequest(async (request, response) => {
    cors(request, response, async () => {

        const year = request.query.gradYear;
        const major = request.query.major;

        if (year === undefined)
            return handleError(request, response, 400, 'Year not provided');
        if (major === undefined)
            return handleError(request, response, 400, 'Major not provided');

        const checksheetId = major.toUpperCase() + '-' + year;
        await checksheetCollection.doc(checksheetId).get()
            .then(async function (doc) {
                if (doc.exists) {

                    const cleanedSheet = doc.data();
                    cleanedSheet.semesters = [];
                    const snapshot = await checksheetCollection.doc(checksheetId).collection('semesters').get();
                    snapshot.forEach(semester => {
                        cleanedSheet.semesters.push(semester.data());
                    });

                    return handleResponse(request, response, 200, cleanedSheet);

                }
                else
                    return handleError(request, response, 400, "Checksheet does not exist.");
            })
            .catch(function (error) {
                return handleError(request, response, 500, error);
            })
    });

});


/**
 * Loads all the courses, checksheets, and pathways into the db
 */
exports.loadResources = functions.firestore
    .document('resources/static')
    .onCreate(async (snap, context) => {
        // Initialize and load database
        console.log("Initializing database...");
        await dbManager.loadDbCourses()
            .catch(function (error) {
                console.log("Failed to load courses", error);
            });

        await dbManager.loadDbChecksheets()
            .catch(function (error) {
                console.log("Failed to load checksheets", error);
            });

        await dbManager.loadDbPathways()
            .catch(function (error) {
                console.log("Failed to load pathways", error);
            });

        console.log("Database initialized and loaded...");

    });


exports.initializeDB = functions.https.onRequest(async (request, response) => {

    await dbManager.loadStaticData()
        .then(function () {
            return handleResponse(request, response, 200, "Success!");
        })
        .catch(function (error) {
            return handleError(request, response, 500, error);
        })

});
