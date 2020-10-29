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
const resoursesCollection = db.collection('resources');

const fs = require('fs');
const dbManager = require('./db-manager');
const dataCleaner = require('./data-cleaner');

// Response Handling
const handleError = (response, status, error) => {
    console.error(status, error);
    return response.status(status).json(error);
};

const handleResponse = (response, status, body) => {
    console.log({
        Response: {
            Status: status,
            Body: body,
        },
    });
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
 * Incomplete
 */
exports.createUser = functions.https.onRequest(async (request, response) => {



});

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

    await resoursesCollection.doc('static').get()
        .then(function (doc) {
            if (doc.exists)
                return handleResponse(response, 200, doc.data().majors);
            else
                return handleError(response, 400, "major does not exist.");
        })
        .catch(function (error) {
            return handleError(response, 500, error);
        });

});

/**
 * Retrieves a list of all supported schools at VT
 */
exports.getAllSchools = functions.https.onRequest(async (request, response) => {

    await resoursesCollection.doc('static').get()
        .then(function (doc) {
            if (doc.exists)
                return handleResponse(response, 200, doc.data().schools);
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

    await resoursesCollection.doc('static').get()
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
                console.log("Failed to load checksheets", error);
            });

        console.log("Database initialized and loaded...");

        // return handleResponse(response, 200, 'Database Initialized and Loaded!');

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
