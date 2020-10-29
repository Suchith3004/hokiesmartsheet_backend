// Firebase Cloud Firestore
const admin = require('firebase-admin');
const db = admin.firestore();
const courseCollection = db.collection('courses');
const checksheetCollection = db.collection('checksheets');
const resoursesCollection = db.collection('resources');

const fs = require('fs');

/**
 * Initializes the database by loading or updating all course information into database. 
 * @param {*} req 
 * @param {*} res - resturns result of load as JSON
 */
exports.loadDbCourses = async (request, response) => {

    console.log("Started loading courses into db...");

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

        const splitTag = course[1].split('-');

        const new_course = {
            category: splitTag[0],
            number: splitTag[1],
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

    console.log("Finished loading courses into db!");

    // response.json({ result: 'db has been loaded with all courses!' });
};

/**
 * Loads the database with all checksheets in directory: ./resources/checksheets/
 */
exports.loadDbChecksheets = async (request, response) => {
    console.log("Started loading checksheets into db...");

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
                    if (!courseDoc.exists) {
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

                        // console.log(updated_course);

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

    // response.json({ result: "db has been loaded with all checksheets!" })

}

/**
 *  Loads the database with pathways for all courses from directory: ./resources/pathways/
 */
exports.loadDbPathways = async (response) => {
    console.log("Started loading pathways into db...");

    const pathwayCategories = ['1a', '1f', '2', '3', '4', '5a', '5f', '6a', '6d', '7'];

    var allLines;
    for (const category of pathwayCategories) {
        const currFile = fs.readFileSync('./resources/pathways/' + category + '.txt').toString('utf-8');

        allLines = currFile.split("\t");

        const pathwayCourses = [];  //courses listed under the pathway
        var courseDoc;
        var batch = db.batch();
        var count = 0;
        for (const line of allLines) {
            if(count == 500) {
                await batch.commit().catch(function (error) {
                    console.log("failed to batch update pathways ", error);
                });
                batch = db.batch();
                count = 0;
            }

            if (line.includes('-') && !line.includes(" ") && !pathwayCourses.includes(line)) {  //Seperate just the class id (ex. CS-2114)
                pathwayCourses.push(line);

                //Get and update course information in db;
                courseDoc = await courseCollection.doc(line).get();

                if (courseDoc.exists) {
                    const updated_course = courseDoc.data();

                    // Add pathways to the course
                    if (!updated_course.pathways) {
                        updated_course.pathways = [];
                    }
                    updated_course.pathways.push(category);

                    batch.set(courseCollection.doc(line), updated_course);
                    // await courseCollection.doc(line).set(updated_course).catch(function (error) {
                    //     console.log("Failed to update pathway for course: " + line, error);
                    // });
                }
            }
            count++;
        }

        if (count != 0) {
            await batch.commit().catch(function (error) {
                console.log("failed to batch update pathways ", error);
            });
        }
    }

    console.log("Finished loading pathways into db.");

}



exports.autocompleteSearch = async(collection, field, prefix, cleanerFunction) => {

    var strSearch = prefix;
    var strlength = strSearch.length;
    var strFrontCode = strSearch.slice(0, strlength - 1);
    var strEndCode = strSearch.slice(strlength - 1, strSearch.length);

    var startcode = strSearch;
    var endcode = strFrontCode + String.fromCharCode(strEndCode.charCodeAt(0) + 1);
    
    console.log(prefix);

    const queryResult = [];
    await collection
        .where(field, '>=', startcode)
        .where(field, '<', endcode)
        .get()
        .then(function(querySnapshot) {
            querySnapshot.forEach(function (doc){
                queryResult.push(doc.data());
            });
        })
        .catch(function(error) {
            throw new Error("Failed to Query. ", error);
        })
    
    return queryResult;
}  

exports.autocompleteSearchSecond = async(collection, field1, search, field2, prefix, cleanerFunction) => {

    var strSearch = prefix;
    var strlength = strSearch.length;
    var strFrontCode = strSearch.slice(0, strlength - 1);
    var strEndCode = strSearch.slice(strlength - 1, strSearch.length);

    var startcode = strSearch;
    var endcode = strFrontCode + String.fromCharCode(strEndCode.charCodeAt(0) + 1);
    
    console.log(prefix);

    const queryResult = [];
    await collection
        .where(field2, '>=', startcode)
        .where(field2, '<', endcode)
        .where(field1, '==', search)
        .get()
        .then(function(querySnapshot) {
            querySnapshot.forEach(function (doc){
                queryResult.push(doc.data());
            });
        })
        .catch(function(error) {
            throw new Error("Failed to Query. ", error);
        })
    
    return queryResult;
}  

const { promisify } = require('util')
const sleep = promisify(setTimeout)   

exports.loadStaticData = async() => {

    const majors = {
        CS: 'Computer Science'
    };

    const schools = ['College of Engineering'];

    const pathways = {
        '1a': 'Advanced/Applied Discourse',
        '1f': 'Foundational Discourse',
        '2': 'Critical Thinking in the Humanities',
        '3': 'Reasoning in the Social Sciences',
        '4': 'Reasoning in the Natural Sciences',
        '5a': 'Advanced/Applied Quantitative and Computational Thinking',
        '5f': 'Foundational Quantitative and Computational Thinking',
        '6a': 'Critique and Practice in the Arts',
        '6d': 'Critique and Practice in Design',
        '7': 'Critical Analysis of Equity and Identity in the United States'
    };

    const staticData = {
        majors: majors,
        schools: schools,
        pathways: pathways
    }

    console.log('Loading static resources...')
    await resoursesCollection.doc('static').set(staticData)
        .catch(function(error) {
            console.log('Failed to add static resources. ', error);
            throw new Error(error);
        });
     
    await sleep(60); //Sleep until loadResources function is triggered and database is loaded

    console.log('Finished loading static resources!');

}