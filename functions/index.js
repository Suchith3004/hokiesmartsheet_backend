//  Firebase functions
const functions = require('firebase-functions');

// Firebase Cloud Firestore
const admin = require('firebase-admin');
const serviceAccount = require('../sec7-firebase-service-account-key.json');
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const courseCollection = db.collection('courses');
const checksheetCollection = db.collection('checksheets');

// Import PScheduler parser
//  const parser = require('pscheduler/src/main/java/com/pscheduler/util/parser');

//  Create and Deploy Your First Cloud Functions
//  https:// firebase.google.com/docs/functions/write-firebase-functions

exports.helloWorld = functions.https.onRequest((request, response) => {
    functions.logger.info("Hello logs!", { structuredData: true });
    response.send("Hello from Firebase!");
});

//  Take the text parameter passed to this HTTP endpoint and insert it into 
//  Cloud Firestore under the path /messages/:documentId/original
exports.addMessage = functions.https.onRequest(async (req, res) => {
    //  Grab the text parameter.
    const original = req.query.text;
    //  Push the new message into Cloud Firestore using the Firebase Admin SDK.
    const writeResult = await db.collection('messages').add({ original: original });
    //  Send back a message that we've succesfully written the message
    res.json({ result: `Message with ID: ${writeResult.id} added.` });
});

/**
 * Initializes the database by loading or updating all course information into database. 
 * @param {*} req 
 * @param {*} res - resturns result of load as JSON
 */
loadDbCourses = async (request, response) => {

    console.log("Initializing courses into db...");

    const fs = require('fs');
    var allCourses = fs.readFileSync("./resources/201909.txt").toString('utf-8');
    var courseLines = allCourses.split("\n");

    var course;
    var course_type;
    var batch = db.batch();
    var count = 0;
    for (const line of courseLines) {
        course = line.split("\t");

        switch (course[3]) {
            case 'I':
                course_type = "Independent Study";
                break;
            case 'B':
                course_type = "Lab";
                break;
            case 'L':
                course_type = "Lecture";
                break;
            case 'R':
                course_type = "Research";
                break;
            case 'C':
                course_type = "Recitation";
                break;
            default:
                course_type = "None";
                break;
        }

        const new_course = {
            name: course[2],
            type: course_type,
            credits: parseInt(course[4]),
        }

        batch.set(courseCollection.doc(course[1]), new_course);

        count++;
        if (count == 500) {
            await batch.commit().catch(function (error) {
                console.log("Failed to batch write courses ", error);
            });
            batch = db.batch();
            count = 0;
        }
    }

    if (count != 0) {
        await batch.commit().catch(function (error) {
            console.log("Failed to batch write courses ", error);
        });
    }

    await courseCollection.doc("Free Elective").set({});  // Free elective course
    await courseCollection.doc("Pathway").set({});         // Pathway course

    console.log("db has been loaded with all courses and checksheets!");

    // response.json({ result: 'db has been loaded with all courses!' });
};

/**
 * 
 * Initializes the database by loading all checksheets into database
 * 
 */
loadDbChecksheets = async (request, response) => {
    console.log("Loading checksheets into db...");

    const fs = require('fs');

    // Adjust later to loop through all directories 
    const checksheets = ['cs2022.csv'];

    var currSheet;
    var allLines;
    for (const sheet of checksheets) {
        currSheet = fs.readFileSync('./resources/checksheets/' + sheet).toString('utf-8');
        allLines = currSheet.split("\n");

        const sheetInfo = allLines[0].split(',');

        const new_checksheet = {
            abrv: sheetInfo[0],
            major: sheetInfo[1],
            year: sheetInfo[2],
            school: sheetInfo[3],
            totalCredits: sheetInfo[4]
        }

        var semesters = [];        // List of all semesters for checksheet
        var pathways = [];         // Pathways for the checksheet
        var electives = [];        // Categories of electives
        var course;
        var curr_course;
        var count = 0;
        var curr_semester = 0;
        var semester_credits = 0;  // total credits for curr_semester
        var semester_courses = []; // List of courses for each semester
        for (const line of allLines) {
            if (count !== 0 && count !== 1) {
                course = line.split(',');

                // Reset local variables between semesters
                if (course[0] !== curr_semester) {

                    // Add semester to list of semesters for checksheet
                    if (curr_semester != 0) {

                        console.log(semester_courses);
                        console.log("=---------------new sem------------");

                        semesters.push({
                            semNum: curr_semester,
                            totalCredits: semester_credits,
                            semesterCourses: semester_courses
                        });
                    }

                    // Reset current semester values
                    curr_semester = course[0];
                    semester_credits = 0;
                    semester_courses = [];
                }

                curr_course = course[1] + '-' + course[2]; // id of current course (ex. CS-2114)

                curr_course = curr_course.replace('/', '|');

                const courseRef = courseCollection.doc(curr_course);
                if (curr_course !== '-') { // if it is a course and not an elective or pathway
                    var courseDoc = await courseRef.get();
                    
                    //Try searching as elective
                    if(!courseDoc.exists) {
                        curr_course = curr_course + '-' + course[5];
                        courseDoc = await courseCollection.doc(curr_course).get();
                    }

                    if (!courseDoc.exists) { // Course isn't in the courses collection
                        // Add course to courses, usually 3/4XXX courses
                        const new_course = {
                            name: "Elective",
                            type: 'N/A',
                            credits: parseInt(course[5])
                        }
                        await courseCollection.doc(curr_course).set(new_course)
                            .catch(function (error) {
                                console.log("Failed to add course: " + curr_course, error);
                            });
                    }
                    else {
                        // Get exisiting course
                        const updated_course = courseDoc.data();

                        // seperate the requisites into array
                        const prerequisites = course[6].split('&');
                        const corequisites = course[7].split('&');

                        // update the course fields
                        updated_course.prerequisites = prerequisites;
                        updated_course.corequisites = corequisites;
                        updated_course.minGrade = course[4];

                        // Update course in db
                        await courseCollection.doc(curr_course).set(updated_course)
                            .catch(function (error) {
                                console.log("Failed to update course: " + curr_course, error);
                            });

                        // add to list of semester courses
                        semester_courses.push({
                            courseId: curr_course,
                            name: updated_course.name,
                            credits: parseInt(course[5])
                        });

                        // add course to list of pathways
                        if (course[8] !== '') {
                            pathways.push({
                                courseId: curr_course,
                                type: course[8]
                            });
                        }
                    }
                }
                else if (course[8] === '0') {  // Course is a pathway
                    semester_courses.push({
                        courseId: "Pathway",
                        name: "Pathway",
                        credits: course[5]
                    });
                }
                else {  // Elective 
                    const elec = course[9].replace("\r", "");

                    semester_courses.push({
                        courseId: elec,
                        name: "Elective",
                        credits: course[5]
                    });
                }

                semester_credits += parseInt(course[5]);  // Add to total credits for semester
            }

            count++;
        }

        semesters.push({
            semNum: curr_semester,
            totalCredits: semester_credits,
            semesterCourses: semester_courses
        });

        new_checksheet.semesters = semesters;
        new_checksheet.pathways = pathways;

        const checksheet_id = sheetInfo[0] + '-' + sheetInfo[2];

        await checksheetCollection.doc(checksheet_id).set(new_checksheet)
            .catch(function (error) {
                console.log("Could not load checksheet for " + checksheet_id, error);
            })

    }

    console.log("Finished loading checksheets into db!");

    response.json({ result: "db has been loaded with all checksheets!" })

}



// Initialize and load database
console.log("Initializing database...");
loadDbCourses().then(function (response) {
    // console.log(response.result);
    loadDbChecksheets().then(function (response) {
        // console.log(response.result());
    })
        .catch(function (error) {
            console.log("Failed to load checksheets", error);
        });
})
    .catch(function (error) {
        console.log("Failed to load courses", error);
    });
console.log("Database initialized and loaded...");
