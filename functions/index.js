//  Firebase functions
const functions = require('firebase-functions');

// Firebase Cloud Firestore
const admin = require('firebase-admin');
const serviceAccount = require('../sec7-firebase-service-account-key.json');

// Initialze application
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const courseCollection = db.collection('courses');
const checksheetCollection = db.collection('checksheets');
const resourcesCollection = db.collection('resources');
const userCollection = db.collection('users');

const fs = require('fs');
const dbManager = require('./db-manager');
const dataCleaner = require('./data-cleaner');

// Response Handling
const handleError = (response, status, error) => {
    console.error(status, error);
    return response.status(status).json(error);
};

const handleResponse = (response, status, body) => {
    // console.log({
    //     Response: {
    //         Status: status,
    //         Body: body,
    //     },
    // });
    response.set('Access-Control-Allow-Origin', '*');
    response.set('Acess-Control-Allow-Methods', 'GET')
    response.set('Access-Control-Allow-Headers', 'Content-Type,Authorization')
    if (body) {
        return response.status(200).json(body);
    }
    return response.sendStatus(status);
};


exports.healthCheck = functions.https.onRequest((request, response) => {
    functions.logger.info("Hello logs!", { structuredData: true });
    return handleResponse(response, 200, "Health Check Successful")
});

//-----------------User Functions-------------------------------
/**
 * Creates a user with the appropriate changes based on completed AP classes and Transfer classes.
 */
exports.createUser = functions.https.onRequest(async (request, response) => {

    if (request.body.userId === undefined || request.body.major === undefined || request.body.gradYear === undefined || request.body.apEquivalents === undefined || request.body.transferCredits === undefined)
        return handleError(response, 400, "Not all parameters provided");

    const userId = request.body.userId;
    const checksheetId = request.body.major + '-' + request.body.gradYear;

    var equivalentsRef = [];
    await resourcesCollection.doc('static').get()
        .then(function (doc) {
            if (doc.exists)
                equivalentsRef = doc.data().apEquivalents;
            else
                return handleError(response, 500, "Static resource (AP equivalents) do not exist.");
        })
        .catch(function (error) {
            handleError(response, 500, error);
        });

    // console.log(equivalentsRef);

    var userChecksheet;
    await checksheetCollection.doc(checksheetId).get()
        .then(function (doc) {
            if (doc.exists) {

                userChecksheet = doc.data();
                userChecksheet.userId = userId;
                userChecksheet.homlessCourses = [];

                userChecksheet.apEquivalents = [];
                //Update all semesters to include completion status and ap/ib equivalent used. (currently only ap)
                const equivalentIds = request.body.apEquivalents;
                for (const equivalentId of equivalentIds) {
                    for (const equivalent of equivalentsRef) {
                        if (equivalentId === equivalent.equivalentId) {
                            const updatedEquivalent = equivalent
                            updatedEquivalent.used = false;


                            for (const semester of userChecksheet.semesters) {
                                const currSemesterCourses = semester.semesterCourses;
                                var courseIndex = 0;
                                var foundCourse;
                                for (const course of semester.semesterCourses) {
                                    if (course.courseId === updatedEquivalent.vtCourseId) {
                                        foundCourse = course;
                                        // break;
                                    }
                                    currSemesterCourses[courseIndex].completed = false;
                                    currSemesterCourses[courseIndex].transferCredit = false;
                                    if (request.body.transferCredits.includes(course.courseId)) {
                                        currSemesterCourses[courseIndex].completed = true;
                                        currSemesterCourses[courseIndex].transferCredit = true;
                                    }

                                    courseIndex++;
                                }

                                // Remove the element from the list
                                if (foundCourse !== undefined && currSemesterCourses.indexOf(foundCourse) > -1) {
                                    updatedEquivalent.used = true;
                                    currSemesterCourses.splice(currSemesterCourses.indexOf(foundCourse), 1);
                                    // break;
                                }
                            }

                            //Add the updated equivalent to the user's checksheet
                            userChecksheet.apEquivalents.push(updatedEquivalent);

                            break;
                        }
                    }
                }

            }
            else {
                return handleError(response, 400, "Checksheet" + checksheetId + "doesn't exist.");
            }

        })
        .catch(function (error) {
            return handleError(response, 500, "Failed to create user. " + error);
        })



    // Add new user checksheet to database
    if (userChecksheet !== undefined) {
        await userCollection.doc(userId).set(userChecksheet)
            .then(function () {
                return handleResponse(response, 200, userChecksheet);
            })
            .catch(function (error) {
                return handleError(response, 500, "Failed to create a user checksheet.");
            });
    }

});

/**
 * Retrieves the checksheet of a user
 */
exports.getUserChecksheet = functions.https.onRequest(async (request, response) => {

    const userId = request.path.replace('/', '');

    await userCollection.doc(userId).get()
        .then(function (doc) {
            if (doc.exists)
                return handleResponse(response, 200, doc.data());
            else
                return handleError(response, 400, "User doesn't exist.");
        })
        .catch(function (error) {
            return handleError(response, 500, "Failed to retrieve checksheet. " + error);
        })

});

/**
 * Moves a class from one semester to another if the prerequisites and co requisites have been met
 */
exports.moveClass = functions.https.onRequest(async (request, response) => {

    const userId = request.body.userId
    const courseId = request.body.courseId;
    const fromSem = request.body.fromSem;
    const toSem = request.body.toSem;

    if (courseId === undefined || fromSem === undefined || toSem === undefined || userId === undefined)
        return handleError(response, 400, "Missing body parameters.");


    const returnStatus = {
        prerequisites: false,
        corequisites: false
    }

    // If pathway or elective it can be immediately moved
    if (courseId.includes('Pathway') || courseId.includes('Elective')) {
        await userCollection.doc(userId).get()
            .then(function (doc) {
                if (doc.exists) {
                    const userChecksheet = doc.data();

                    internalMoveCourse(userChecksheet, toSem, fromSem, courseId, userId);
                    // .then(function () {
                    returnStatus.prerequisites = true;
                    returnStatus.corequisites = true;

                    return handleResponse(response, 200, returnStatus);
                    // })
                    // .catch(function(error) {
                    //     return handleError(response, 500, error);
                    // });
                }
            })
            .catch(function (error) {
                return handleError(response, 500, error);
            });
    }

    var courseToMove;

    await courseCollection.doc(courseId).get()
        .then(function (doc) {
            if (doc.exists)
                courseToMove = doc.data();
            else
                return handleError(response, 400, "Course " + courseId + " doesn't exist in the db.");
        })
        .catch(function (error) {
            return handleError(response, 500, error);
        });

    await userCollection.doc(userId).get()
        .then(function (doc) {
            if (doc.exists) {
                const userChecksheet = doc.data();

                const preReqs = courseToMove.prerequisites;
                const coReqs = courseToMove.corequisites;
                for (var i = 0; i < userChecksheet.semesters.length && i <= toSem; i++) {
                    const currSem = userChecksheet.semesters[i];
                    for (var k = 0; k < currSem.semesterCourses.length; k++) {
                        const currCourse = currSem.semesterCourses[k];

                        // Check prereqs and remove any that have been accounted for in previous semester
                        if (i !== toSem) {
                            for (var j = 0; j < preReqs.length; j++) {
                                if (preReqs[j].includes(currCourse.courseId)) {
                                    preReqs.splice(j, 1);
                                    j--;
                                }
                            }
                        }

                        //Check coreqs and remove any that have been accounted for in previous semester
                        for (var j = 0; j < coReqs.length; j++) {
                            if (coReqs[j].includes(currCourse.courseId)) {
                                coReqs.splice(j, 1);
                                j--;
                            }
                        }

                    }
                }

                if (preReqs.length === 0)
                    returnStatus.prerequisites = true;

                if (coReqs.length === 0)
                    returnStatus.corequisites = true;

                // Move course if both prerequisites and corequisites are met
                if (returnStatus.prerequisites && returnStatus.corequisites) {
                    internalMoveCourse(userChecksheet, toSem, fromSem, courseId, userId);
                }


                return handleResponse(response, 200, returnStatus);
            }
            else {
                return handleError(response, 400, "User " + userId + " not found.");
            }
        })
        .catch(function (error) {
            return handleError(response, 500, error);
        });

});

/**
 * Moves the course with courseId from fromSem to toSem for the specified user.
 */
internalMoveCourse = async (checksheet, toSem, fromSem, courseId, userId) => {
    var userChecksheet = checksheet;
    const currSem = userChecksheet.semesters[fromSem];

    var foundCourse;
    var courseIndex = 0;
    for (const course of currSem.semesterCourses) {
        if (course.courseId === courseId)
            foundCourse = course;
        courseIndex++;
    }

    if (foundCourse === undefined)
        throw new Error("Course does not exist. Cannot be moved.");

    // Remove from old semester
    userChecksheet.semesters[fromSem].semesterCourses.splice(courseIndex, 1);

    // Add to new semester
    userChecksheet.semesters[toSem].semesterCourses.push(foundCourse);

    await userCollection.doc(userId).set(userChecksheet)
        .catch(function (error) {
            throw new Error("Failed to move course. " + error);
        })
}

/**
 * Returns a course with the name of the prefix
 */
exports.getCourseByPrefix = functions.https.onRequest(async (request, response) => {

    const category = request.query.category;
    const number = request.query.number;

    if (category === undefined)
        return handleError(response, 400, "Course category not provided (undefined).")

    if (number === undefined)
        return handleError(response, 400, "Course category not provided (undefined).")

    const coursePrefix = category.toUpperCase() + '-' + number;

    const courseRef = await courseCollection.doc(coursePrefix).get();

    if (courseRef.exists) {
        // const course = dataCleaner.cleanCourse(courseRef.data(), coursePrefix);
        return handleResponse(response, 200, courseRef.data());
    }
    else {
        return handleError(response, 400, 'Course not found: ' + coursePrefix);
    }
});

/**
 * Returns a list of courses that start with the category prefix and/or number prefix of course provided
 */
exports.autocompleteCoursePrefix = functions.https.onRequest(async (request, response) => {

    const category = request.query.category;
    const number = request.query.number;

    if (category === undefined)
        return handleError(response, 400, "Course category not provided (undefined).")

    if (number !== undefined) {
        await dbManager.autocompleteSearch(courseCollection, 'category', category, 'number', number)
            .then(function (queryResult) {
                return handleResponse(response, 200, queryResult);
            })
            .catch(function (error) {
                return handleError(response, 400, error);
            });
    }
    else { //just category
        await dbManager.autocompleteSearch(courseCollection, 'category', category)
            .then(function (queryResult) {
                return handleResponse(response, 200, queryResult);
            })
            .catch(function (error) {
                return handleError(response, 400, error);
            });
    }

});

/**
 * Returns a course using the name of the course
 */
exports.getCourseByName = functions.https.onRequest(async (request, response) => {

    const courseName = (request.path).replace('/', '');

    if (courseName === undefined)
        return handleError(response, 400, "Course name not provided (undefined).");

    const courseRef = await courseCollection.doc(courseName).get();

    if (courseRef.exists)
        return handleResponse(response, 200, courseRef.data());
    else
        return handleError(response, 400, 'Course not found: ' + courseName);

});

/**
 * Returns a list of courses that start with the course name prefix provided
 */
exports.autocompleteCourseName = functions.https.onRequest(async (request, response) => {

    const courseName = (request.path).replace('/', '');

    if (courseName === undefined)
        return handleError(response, 400, "Course name not provided (undefined).");


    await dbManager.autocompleteSearch(courseCollection, 'name', courseName)
        .then(function (queryResult) {
            return handleResponse(response, 200, queryResult);
        })
        .catch(function (error) {
            return handleError(response, 400, error);
        });
});

/**
 * Retrieves a list of all supported majors at VT
 */
exports.getAllMajors = functions.https.onRequest(async (request, response) => {

    await resourcesCollection.doc('static').get()
        .then(function (doc) {
            if (doc.exists)
                return handleResponse(response, 200, doc.data().majors);
            else
                return handleError(response, 400, "static resources do not exist.");
        })
        .catch(function (error) {
            return handleError(response, 500, error);
        });

});

/**
 * Returns a list of all AP equivalents
 */
exports.getAllAPEquivalents = functions.https.onRequest(async (request, response) => {

    await resourcesCollection.doc('static').get()
        .then(function (doc) {
            if (doc.exists)
                return handleResponse(response, 200, doc.data().ap_equivalents);
            else
                return handleError(response, 400, "static resources do not exist.");
        })
        .catch(function (error) {
            return handleError(response, 500, error);
        });

});

/**
 * Retrieves a list of all supported schools at VT
 */
exports.getAllSchools = functions.https.onRequest(async (request, response) => {

    await resourcesCollection.doc('static').get()
        .then(function (doc) {
            if (doc.exists) {
                const schools = [];
                const schoolsRef = doc.data().schools;
                for (var key in schoolsRef)
                    if (schoolsRef.hasOwnProperty(key))
                        schools.push(key);

                return handleResponse(response, 200, schools);
            }
            else
                return handleError(response, 400, "Schools does not exist.");
        })
        .catch(function (error) {
            return handleError(response, 500, error);
        });
});

/**
 * Retrieves a list of all supported schools at VT
 */
exports.getAllPathways = functions.https.onRequest(async (request, response) => {

    await resourcesCollection.doc('static').get()
        .then(function (doc) {
            if (doc.exists)
                return handleResponse(response, 200, doc.data().pathways);
            else
                return handleError(response, 400, "Pathways does not exist.");
        })
        .catch(function (error) {
            return handleError(response, 500, error);
        });
});


// ----------------- Checksheet Functions ------------------
exports.getDefaultChecksheet = functions.https.onRequest(async (request, response) => {

    const year = request.query.gradYear;
    const major = request.query.major;

    if (year === undefined)
        return handleError(response, 400, 'Year not provided');
    if (major === undefined)
        return handleError(response, 400, 'Major not provided');

    await checksheetCollection.doc(major.toUpperCase() + '-' + year).get()
        .then(function (doc) {
            if (doc.exists)
                return handleResponse(response, 200, doc.data());
            else
                return handleError(response, 400, "Checksheet does not exist.");
        })
        .catch(function (error) {
            return handleError(response, 500, error);
        })

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
            return handleResponse(response, 200, "Success!");
        })
        .catch(function (error) {
            return handleError(response, 500, error);
        })

});
