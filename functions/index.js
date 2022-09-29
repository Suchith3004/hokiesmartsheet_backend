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
exports.initializeDB = functions
    .runWith({ timeoutSeconds: 300 })
    .https.onRequest(async(request, response) => {

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

        await organizationCollection.doc("CS-Mentoring").set({
            name: "CS Mentoring Club",
            school: "Computer Science",
            representatives: {},
            description: "A peer-to-peer mentoring program designed to pair freshman and sophomores who are CS majors or planning to be CS majors with juniors and seniors in the major.  The mentoring will include one-on-one mentoring as well as monthly meetings."
        })

        await organizationCollection.doc("Hokie-Mentorship-Connect").set({
            name: "Hokie Mentorship Connect",
            school: "Virginia Tech",
            representatives: {},
            description: "Career and Professional Development is building our Virginia Tech family through mentoring and purposeful connections!"
        })

        await organizationCollection.doc("CS-Volunteering").set({
            name: "CS Volunteering Club",
            school: "Computer Science",
            representatives: {},
            description: "Undergraduate Computer Science students volunteer to make a difference in the community."
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
            userChecksheet.gradYear = request.body.gradYear;
            userChecksheet.gradSeason = request.body.gradSeason;
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

        // Update user checksheet to adjust for AP/IB classes (only AP right now)
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


        const transferCredits = request.body.transferCredits;
        for (const semDoc of semSnapshot.docs) {
            const semester = semDoc.data();
            semester.courseReferences = [];
            const coursesToRemove = [];

            semester.semesterCourses.forEach((course, i) => {

                semester.semesterCourses[i].pathway = course.courseId.includes('Pathway') || userChecksheet.pathwayIds.includes(course.courseId);
                semester.semesterCourses[i].elective = course.name.includes('Elective')

                // Check if credit is recieved through transfer credit
                if (transferCredits.includes(course.courseId)) {
                    course.used = true;
                    course.elective = false;
                    userChecksheet.transferCourses.push(course);
                    transferCredits.splice(transferCredits.indexOf(course.courseId), 1);
                    coursesToRemove.push(course);
                    semester.totalCredits -= course.credits;
                } else {
                    // add course to references
                    // console.log(course.courseId)
                    semester.courseReferences.push(course.courseId);
                    semester.semesterCourses[i].completed = false;
                }
            });

            coursesToRemove.forEach(courseRemove => {
                semester.semesterCourses.splice(semester.semesterCourses.indexOf(courseRemove), 1);
            })

            // Add semester to user checksheet collection
            await userCollection.doc(userId).collection('semesters').doc(semDoc.id).set(semester)
                .catch(error => {
                    return handleError(response, 500, error);
                })
        }
        for (const transfer of transferCredits) {
            await courseCollection.doc(transfer).get()
                .then(doc => {
                    if (doc.exists) {
                        const courseToAdd = {
                            used: false,
                            pathway: false,
                            elective: false,
                            courseId: transfer,
                            name: doc.data().name,
                            credits: doc.data().credits
                        }
                        userChecksheet.transferCourses.push(courseToAdd)
                    }
                })
                .catch(error => {
                    handleResponse(response, 500, error)
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
                        updatedEquivalent.credits = course.credits
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

        //Add completed field to all the pathways
        const pathways = userChecksheet.pathways
        pathways.forEach((_, index) => {
            pathways[index].completed = false;
        })

        userChecksheet.pathways = pathways;

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
exports.getUser = functions.https.onRequest(async(request, response) => {
    cors(request, response, async() => {

        const userId = request.path.replace('/', '');

        await userCollection.doc(userId).get()
            .then(async function(doc) {
                if (doc.exists) {
                    if (!doc.data().isMentor || doc.data().major) {
                        const cleanedSheet = doc.data();
                        cleanedSheet.semesters = [];
                        const snapshot = await userCollection.doc(userId).collection('semesters').get();
                        snapshot.forEach(semester => {

                            const currSem = semester.data();
                            delete currSem.courseReferences;
                            cleanedSheet.semesters.push(currSem);
                        });
                        return handleResponse(response, 200, cleanedSheet);
                    } else {
                        return handleResponse(response, 200, doc.data())
                    }
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
        const userId = request.body.userId;
        const courseId = request.body.courseId;
        const fromSem = request.body.fromSem;
        const toSem = request.body.toSem;
        const toIndex = request.body.toIndex;

        if (!courseId || !fromSem || !toSem || !userId || !toIndex)
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
            await this.internalMoveCourse(toSem, fromSem, courseId, userId, toIndex)
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

            if (preReqs) {
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
            }
            if (coReqs) {
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
        if (!preReqs || preReqs.length === 0)
            moveStatus.prerequisites = true;

        if (!coReqs || coReqs.length === 0)
            moveStatus.corequisites = true;


        moveStatus.preReqsNotMet = (preReqs && preReqs.length > 0) ? preReqs : "N/A";
        moveStatus.coReqsNotMet = (coReqs && coReqs.length > 0) ? coReqs : "N/A";
        moveStatus.dependentCourses = (dependentCourses.length) ? dependentCourses : "N/A";

        if (moveStatus.prerequisites && moveStatus.corequisites && !moveStatus.dependents) {
            await this.internalMoveCourse(toSem, fromSem, courseId, userId, toIndex)
                .catch(error => {
                    return handleError(response, 500, error);
                });


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
                        moveStatus.userData = cleanedSheet
                        return handleResponse(response, 200, moveStatus);
                    }
                    return handleError(response, 400, "User doesn't exist.");
                })

        } else {
            return handleResponse(response, 200, moveStatus);
        }

    });

});

/**
 * Moves the course with courseId from fromSem to toSem for the specified user.
 */
this.internalMoveCourse = async(toSem, fromSem, courseId, userId, toIndex) => {

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
    toSemester.courseReferences.splice(toIndex, 0, courseId);
    toSemester.semesterCourses.splice(toIndex, 0, course);
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


exports.assignPathway = functions.https.onRequest(async(request, response) => {
    cors(request, response, async() => {

        const userId = request.body.userId;
        const sem = request.body.semester;
        const pathwayId = request.body.pathwayId;
        const pathwayType = request.body.pathwayType;
        const newCourseId = request.body.courseId;
        const newCourseType = request.body.courseType;

        if (!sem || !pathwayId || !userId || !pathwayType || !newCourseId || !newCourseType)
            return handleError(response, 400, "One or more of the required body parameters are missing!");

        const semId = "Semester " + sem;
        const userDoc = await userCollection.doc(userId).get()
            .catch(error => {
                return handleError(response, 500, error);
            })

        if (!userDoc.exists)
            return handleError(response, 400, "User Id " + userId + " does not exist");

        const userSheet = userDoc.data()

        const semesterDoc = await userCollection.doc(userId).collection('semesters').doc(semId).get()
            .catch(error => {
                return handleError(response, 400, error)
            })

        if (!semesterDoc.exists)
            return handleError(response, 400, semId + " does not exist.");

        const semester = semesterDoc.data()

        const courseIndex = semester.courseReferences.indexOf(pathwayId)
        if (courseIndex < 0) {
            return handleError(response, 400, pathwayId + " does not exist.");
        }

        //TODO: reconsider pathway 7 logic
        if (userSheet.pathwayIds.includes(newCourseId) && pathwayType !== '7')
            return handleError(response, 400, newCourseId + " already used as a pathway.")

        if (newCourseType === 'AP') {
            const apEquivalents = userSheet.apEquivalents;

            for (var i = 0; i < apEquivalents.length; i++) {
                if (apEquivalents[i].vtCourseId === newCourseId && !apEquivalents[i].used) {
                    apEquivalents[i].used = true;
                    apEquivalents[i].pathway = true;

                    userSheet.pathways.push({
                        type: pathwayType,
                        credits: apEquivalents[i].credits ? apEquivalents[i].credits : 3, //TODO: BANDAGE
                        name: apEquivalents[i].vtCourseName,
                        courseId: apEquivalents[i].vtCourseId,
                        completed: true
                    })
                    userSheet.pathwayIds.push(apEquivalents[i].vtCourseId)

                    //TODO: account for if its already been taken by elective or another thing
                    break;
                } else if (i == apEquivalents.length - 1) {
                    return handleError(response, 400, "No Ap equivalent fits the criteria"); //Warn for using an ap that is already used
                }
            }

            userSheet.apEquivalents = apEquivalents;
        } else if (newCourseType === 'Transfer') {
            const transferCourses = userSheet.transferCourses;

            for (i = 0; i < transferCourses.length; i++) {
                if (transferCourses[i].courseId === newCourseId && !transferCourses[i].used) {
                    transferCourses[i].used = true;
                    transferCourses[i].pathway = true;
                    //TODO: account for if its already been taken by elective or another thing

                    userSheet.pathways.push({
                        type: pathwayType,
                        credits: transferCourses[i].credits,
                        name: transferCourses[i].name,
                        courseId: transferCourses[i].courseId,
                        completed: true
                    })
                    userSheet.pathwayIds.push(transferCourses[i].courseId)

                    break;
                } else if (i == transferCourses.length - 1) {
                    return handleError(response, 400, "No transfer exists to match " + newCourseId);
                }
            }

            userSheet.transferCourses = transferCourses;
        } else {

            var querySnapshot = await userCollection.doc(userId).collection('semesters')
                .where('courseReferences', 'array-contains', newCourseId).get()
                .catch(function(error) {
                    return handleError(response, 500, error);
                });

            if (!querySnapshot.empty)
                return handleResponse(response, 400, newCourseId + " has already been used.")

            await courseCollection.doc(newCourseId).get()
                .then(doc => {
                    if (!doc.exists)
                        return handleError(response, 400, newCourseId + " does not exist!");

                    ///|| !(pathwayType === '7' && (doc.data().pathways.includes('3') || doc.data().pathways.includes('2')))
                    if (!doc.data().pathways.includes(pathwayType))
                        return handleError(response, 400, newCourseId + " does not have pathway type " + pathwayType);

                    //Add the new course into list
                    semester.totalCredits += doc.data().credits
                    semester.courseReferences.push(newCourseId);
                    semester.semesterCourses.push({
                        completed: false,
                        credits: doc.data().credits,
                        name: doc.data().name,
                        pathway: true,
                        courseId: newCourseId
                    })

                    userSheet.pathways.push({
                        type: pathwayType,
                        courseId: newCourseId,
                        name: doc.data().name
                    })
                    userSheet.pathwayIds.push(newCourseId)

                })
                .catch(error => {
                    handleResponse(response, 500, error);
                })

        }

        if (userSheet.pathwayIds.includes(pathwayId)) {
            const pathwayIndex = userSheet.pathwayIds.indexOf(pathwayId);
            userSheet.pathways.splice(pathwayIndex, 1);
            userSheet.pathwayIds.splice(pathwayIndex, 1)
        }

        //Remove pathway from list of course
        semester.totalCredits -= semester.semesterCourses[courseIndex].credits;
        semester.courseReferences.splice(courseIndex, 1);
        semester.semesterCourses.splice(courseIndex, 1);


        await userCollection.doc(userId).set(userSheet)
            .catch(error => {
                return handleResponse(response, 500, error)
            })

        await userCollection.doc(userId).collection('semesters').doc(semId).set(semester)
            .then(() => {
                return handleResponse(response, 200)
            })
            .catch(error => {
                return handleResponse(response, 500, error)
            })
    });
})


exports.assignElective = functions.https.onRequest(async(request, response) => {
    cors(request, response, async() => {

        const userId = request.body.userId;
        const sem = request.body.semester;
        const electiveId = request.body.electiveId;
        const newCourseId = request.body.courseId;
        const newCourseType = request.body.courseType;

        if (!sem || !electiveId || !userId || !newCourseId || !newCourseType)
            return handleError(response, 400, "One or more of the required body parameters are missing!");

        const semId = "Semester " + sem;
        const userDoc = await userCollection.doc(userId).get()
            .catch(error => {
                return handleError(response, 500, error);
            })

        if (!userDoc.exists)
            return handleError(response, 400, "User Id " + userId + " does not exist");

        const userSheet = userDoc.data()

        const semesterDoc = await userCollection.doc(userId).collection('semesters').doc(semId).get()
            .catch(error => {
                return handleError(response, 400, error)
            })

        if (!semesterDoc.exists)
            return handleError(response, 400, semId + " does not exist.");

        const semester = semesterDoc.data()

        const courseIndex = semester.courseReferences.indexOf(electiveId)
        if (courseIndex < 0) {
            return handleError(response, 400, electiveId + " does not exist.");
        }

        //TODO: Add elective options check
        //TODO: Add 3/4XXX check
        if (newCourseType === 'AP') {
            const apEquivalents = userSheet.apEquivalents;

            for (var i = 0; i < apEquivalents.length; i++) {
                if (apEquivalents[i].vtCourseId === newCourseId && !apEquivalents[i].used) {
                    apEquivalents[i].used = true;
                    apEquivalents[i].pathway = true;
                    //TODO: account for if its already been taken by elective or another thing
                    break;
                } else if (i == apEquivalents.length - 1) {
                    return handleError(response, 400, "No Ap equivalent fits the criteria"); //Warn for using an ap that is already used
                }
            }

            userSheet.apEquivalents = apEquivalents;
        } else if (newCourseType === 'Transfer') {
            const transferCourses = userSheet.transferCourses;

            for (i = 0; i < transferCourses.length; i++) {
                if (transferCourses[i].courseId === newCourseId && !transferCourses[i].used) {
                    transferCourses[i].used = true;
                    transferCourses[i].elective = true;
                    //TODO: account for if its already been taken by elective or another thing
                    break;
                } else if (i == transferCourses.length - 1) {
                    return handleError(response, 400, "No Transfer course exists that matches " + newCourseId);
                }
            }

            userSheet.transferCourses = transferCourses;
        } else {
            await courseCollection.doc(newCourseId).get()
                .then(doc => {
                    if (!doc.exists)
                        return handleError(response, 400, newCourseId + " does not exist!");

                    //Add the new course into list
                    semester.totalCredits += doc.data().credits
                    semester.courseReferences.push(newCourseId);
                    semester.semesterCourses.push({
                        completed: false,
                        credits: doc.data().credits,
                        name: doc.data().name,
                        pathway: false,
                        elective: true,
                        courseId: newCourseId
                    })

                })
                .catch(error => {
                    handleResponse(response, 500, error);
                })
        }

        //Remove pathway from list of course
        semester.totalCredits -= semester.semesterCourses[courseIndex].credits;
        semester.courseReferences.splice(courseIndex, 1);
        semester.semesterCourses.splice(courseIndex, 1);


        await userCollection.doc(userId).set(userSheet)
            .catch(error => {
                return handleResponse(response, 500, error)
            })

        await userCollection.doc(userId).collection('semesters').doc(semId).set(semester)
            .then(() => {
                return handleResponse(response, 200)
            })
            .catch(error => {
                return handleResponse(response, 500, error)
            })
    });
})



exports.changeCourseStatus = functions.https.onRequest(async(request, response) => {
    cors(request, response, async() => {

        const userId = request.body.userId;
        const sem = request.body.semester;
        const courseId = request.body.courseId;

        //TODO: Retrieve semester ourself???
        if (!userId || !sem || !courseId)
            return handleError(response, 400, "Required body parameters are missing.")

        const semId = "Semester " + sem;
        const userRef = await userCollection.doc(userId).get()
            .catch(error => {
                return handleError(response, 500, error);
            })

        if (!userRef.exists)
            handleError(response, 400, userId + " does not exist.")

        const userSheet = userRef.data();

        const semRef = await userCollection.doc(userId).collection('semesters').doc(semId).get()
            .catch(error => {
                return handleError(response, 500, error)
            })

        if (!semRef.exists)
            return handleError(response, 400, semId + " does not exist")

        const semester = semRef.data()

        if (!semester.courseReferences.includes(courseId))
            return handleError(response, 400, courseId + " does not exist in " + semId + '.')

        const courseIndex = semester.courseReferences.indexOf(courseId)
        semester.semesterCourses[courseIndex].completed = !semester.semesterCourses[courseIndex].completed;

        if (userSheet.pathwayIds.includes(courseId)) {
            const pathwayIndex = userSheet.pathwayIds.indexOf(courseId);
            userSheet.pathways[pathwayIndex].completed = semester.semesterCourses[courseIndex].completed
        }

        userSheet.apEquivalents.forEach((equivalent, index) => {
            if (equivalent.vtCourseId === courseId) {
                if (!userSheet.apEquivalents[index].used)
                    userSheet.apEquivalents[index].used = semester.semesterCourses[courseIndex].completed
            }
        })

        userSheet.transferCourses.forEach((transfer, index) => {
            if (transfer.vtCourseId === courseId) {
                if (!userSheet.transferCourses[index].used)
                    userSheet.transferCourses[index].used = semester.semesterCourses[courseIndex].completed
            }
        })


        //TODO: Upload seperately later, use merge a lot more!
        await userCollection.doc(userId).collection('semesters').doc(semId).set(semester)
            .catch(error => {
                return handleError(response, 500, error)
            })

        await userCollection.doc(userId).set(userSheet)
            .then(() => {
                return handleResponse(response, 200);
            })
            .catch(error => {
                return handleError(response, 500, error);
            })


    })
})



exports.addApEquivalents = functions.https.onRequest(async(request, response) => {
    cors(request, response, async() => {

        const userId = request.body.userId;
        const apEquivalents = request.body.apEquivalents;

        if (!userId || !apEquivalents)
            return handleError(response, 400, "Missing required body paramenters.");

        const userRef = await userCollection.doc(userId).get()
            .catch(error => {
                return handleError(response, 500, error);
            })

        if (!userRef.exists)
            handleError(response, 400, userId + " does not exist.")

        const userChecksheet = userRef.data()

        for (const equivalentId of apEquivalents) {

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

    })

})





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


exports.getCoursesByPathway = functions.https.onRequest(async(request, response) => {
    cors(request, response, async() => {

        const pathways = request.body.pathways;

        if (!pathways)
            return handleError(response, 400, "Missing required body parameters!");

        const results = [];

        for (const pathwayType of pathways) {

            if (!pathwayType)
                continue;

            var querySnapshot = await courseCollection
                .where('pathways', 'array-contains', pathwayType).get()
                .catch(function(error) {
                    return handleError(response, 500, error);
                });

            if (!querySnapshot.empty) {

                querySnapshot.docs.forEach(doc => {

                    const foundCourse = {
                        name: doc.data().name,
                        credits: doc.data().credits,
                        courseId: doc.id
                    }
                    if (results.indexOf(foundCourse) < 0)
                        results.push(foundCourse)
                })
            }
        }

        return handleResponse(response, 200, results);
    })
})

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
 * Retrieves a list of electives within type
 */
exports.getElectiveOptions = functions.https.onRequest(async(request, response) => {
    cors(request, response, async() => {

        const electiveType = request.path.replace('/', '').trim().toLowerCase().replace('%20', ' ');

        await resourcesCollection.doc('static').get()
            .then(async(doc) => {
                const staticResources = doc.data();
                const electives = staticResources.electives;

                if (electives[electiveType]) {
                    const cleanedCourses = [];

                    for (const course of electives[electiveType]) {
                        await courseCollection.doc(course).get()
                            .then((doc) => {
                                if (doc.exists) {
                                    cleanedCourses.push({
                                        courseId: course,
                                        name: doc.data().name,
                                        credits: doc.data().credits
                                    })
                                }
                            })
                            .catch(error => {
                                handleError(response, 500, error)
                            })
                    }

                    return handleResponse(response, 200, cleanedCourses)
                } else {
                    return handleError(response, 400, electiveType + " does not exist.")
                }
            })
            .catch(error => {
                return handleResponse(response, 500, error)
            })

    })
})

exports.getElectiveCategories = functions.https.onRequest(async(request, response) => {
    cors(request, response, async() => {

        const electives = ["Capstone", "Natural Science", "Professional Writing", "Communications", "CS Theory", "Statistics"]

        return handleResponse(response, 200, electives)
            // await resourcesCollection.doc('static').get()
            //     .then(() => {
            //         // const staticResources = doc.data();
            //         const electives = ["Capstone", "Natural Science", "Professional Writing", "Communications", "CS Theory", "Statistics"]

        //         return handleResponse(response, 200, electives)
        //     })
        //     .catch(error => {
        //         return handleResponse(response, 500, error)
        //     })

    })
})



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
                mentor.userId = mentorId
                return handleResponse(response, 200, mentor);
            })
            .catch(error => {
                return handleError(response, 500, "Failed to add mentor " + mentorId + ". " + error.message);
            })

    })

});
//TODO: Make all errors more specific.

exports.getAllUserConnections = functions.https.onRequest(async(request, response) => {

    cors(request, response, async() => {

        const userId = request.body.userId;

        const userDoc = await userCollection.doc(userId).get()
            .catch(error => {
                return handleError(response, 500, error);
            })

        var user = userDoc.data();

        var connectionsData = [];

        if (user.mentees) {
            console.log("mentees being looked at connections = ", connectionsData);
            console.log("mentees = ", user.mentees);
            for (let [key] of Object.entries(user.mentees)) {
                await userCollection.doc(key).get()
                    .then(doc => {
                        var userData = doc.data();
                        if (!userData.userId) {
                            userData.userId = key;
                        }
                        userData.isUsersMentor = false;
                        connectionsData.push(userData);
                    });
            }
            console.log("mentees done data = ", connectionsData);
        }

        if (user.mentors) {
            for (let [key] of Object.entries(user.mentors)) {
                await userCollection.doc(key).get()
                    .then(doc => {
                        var userData = doc.data();
                        if (!userData.userId) {
                            userData.userId = key;
                        }
                        userData.isUsersMentor = true;
                        connectionsData.push(userData);
                    });
            }
        }

        return handleResponse(response, 200, connectionsData);

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
        const orgDoc = await organizationCollection.doc(organizationId).get()
            .catch(error => {
                return handleError(response, 500, error);
            })
            // Add mentor status to user

        if (!orgDoc.exists)
            return handleError(response, 400, "Organization " + organizationId + " does not exist.");

        const organizationInfo = orgDoc.data();

        const user = userDoc.data();
        user.isMentor = true;
        user.organizationId = organizationId;
        user.organizationName = organizationInfo.name;
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

        //Check if mentor already has a request from that mentee
        if (mentor.requests[menteeId])
            return handleError(response, 400, mentorId + " already has a request from " + menteeId);

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

        //Check if mentor has a request from the mentor
        if (!mentor.requests[menteeId])
            return handleError(response, 400, mentorId + " does not have a request from " + menteeId);


        // Update requests to reflect response
        const mentorName = mentor.firstName + ' ' + mentor.lastName;
        const menteeName = mentee.firstName + ' ' + mentee.lastName;

        if (result) { // Accepted
            delete mentor.requests[menteeId];
            mentee.mentorRequests[mentorId] = 'ACCEPTED';

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

        const userId = request.path.replace('/', '');

        const userDoc = await userCollection.doc(userId).get()
            .catch(error => {
                return handleError(response, 500, error)
            })

        if (!userDoc.exists)
            return handleError(response, 400, userId + " does not exist.");

        const mentee = userDoc.data();

        await userCollection.where('isMentor', '==', true).get()
            .then(function(querySnapshot) {
                const mentors = [];
                querySnapshot.forEach(function(doc) {
                    const mentor = doc.data();

                    if (!mentee.mentorRequests[doc.id] && userId !== doc.id) {
                        const cleanedMentor = {
                            userId: doc.id,
                            name: mentor.firstName + ' ' + mentor.lastName,
                            organizationName: mentor.organizationName,
                            occupation: mentor.occupation,
                            description: mentor.description,
                            vtAlumni: mentor.vtAlumni
                        }
                        mentors.push(cleanedMentor);
                    }
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



exports.shareMenteeChecksheet = functions.https.onRequest(async(request, response) => {

    cors(request, response, async() => {

        const menteeId = request.body.menteeId;
        const mentorId = request.body.mentorId;
        const semesters = request.body.semesters;
        const ap = request.body.ap;
        const transfer = request.body.transfer;
        const pathways = request.body.pathways;

        if (!(menteeId && mentorId && semesters && ap !== undefined && transfer !== undefined && pathways !== undefined))
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

        //Check if mentor is a mentor of mentee
        if (!mentee.mentors[mentorId])
            return handleError(response, 400, mentorId + " is not a mentor of mentee " + menteeId);

        const sharedSheet = {}
        sharedSheet.semesters = []

        semesters.sort((a, b) => a - b)
        for (const sem of semesters) {
            const semId = "Semester " + sem;

            const semDoc = await userCollection.doc(menteeId).collection('semesters').doc(semId).get()
                .catch(error => {
                    return handleResponse(response, 500, error)
                })

            if (semDoc.exists) {
                sharedSheet.semesters.push({
                    semNum: semDoc.data().semNum,
                    semesterCourses: semDoc.data().semesterCourses,
                    totalCredits: semDoc.data().totalCredits
                })
            }
        }

        if (ap) {
            sharedSheet.apEquivalents = mentee.apEquivalents;
        }

        if (transfer) {
            sharedSheet.transferCourses = mentee.transferCourses;
        }

        if (pathways) {
            sharedSheet.pathways = mentee.pathways;
        }

        if (!mentee.shared)
            mentee.shared = {}

        mentee.shared[mentorId] = { smesters: semesters, ap: ap, transfer: transfer, pathways: pathways }

        sharedSheet.major = mentee.major;
        sharedSheet.school = mentee.school;
        sharedSheet.totalCredits = mentee.totalCredits;

        await userCollection.doc(menteeId).set(mentee)
            .catch(error => {
                return handleResponse(response, 500, error)
            })

        await userCollection.doc(mentorId).collection('shared').doc(menteeId).set(sharedSheet)
            .then(() => {
                return handleResponse(response, 200)
            })
            .catch(error => {
                return handleResponse(response, 500, error)
            })


    })
})


exports.getSharedChecksheet = functions.https.onRequest(async(request, response) => {

    cors(request, response, async() => {

        const menteeId = request.body.menteeId;
        const mentorId = request.body.mentorId;

        console.log(request.body)

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

        //Check if mentor is a mentor of mentee
        if (!mentee.mentors[mentorId])
            return handleError(response, 400, mentorId + " is not a mentor of mentee " + menteeId);

        if (!mentee.shared[mentorId])
            return handleError(response, 400, mentorId + " does not have access to checksheet of " + menteeId);

        await userCollection.doc(mentorId).collection('shared').doc(menteeId).get()
            .then(doc => {
                return handleResponse(response, 200, doc.data())
            })
            .catch(error => {
                return handleResponse(response, 500, error)
            })
    })
})