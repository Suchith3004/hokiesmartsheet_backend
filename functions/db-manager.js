/**
 * Author: Suchith Suddala
 * Date: 11/4/2020
 * 
 */

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
exports.loadDbCourses = async () => {

    console.log("Started loading courses into db...");

    var allCourses = fs.readFileSync("./resources/201909.txt").toString('utf-8');
    var courseLines = allCourses.split("\n");

    var course;
    var course_type;
    var batch = db.batch();
    var count = 0;

    var currCourse = '';
    var currCourseInfo = {
        lecture: false,
        lab: false
    };
    for (const line of courseLines) {
        course = line.split("\t");
        
        if(currCourse !== course[1]) {
            currCourse = course[1];
            currCourseInfo.lecture = false;
            currCourseInfo.lab = false;
        }

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

        const courseId = course[1];        
        if (new_course.type !== 'Lab' && new_course.type !== 'Lecture') {
            batch.set(courseCollection.doc(courseId), new_course);
        }
        else if(new_course.type === 'Lecture' && !currCourseInfo.lecture) {
            if(currCourseInfo.lab) {
                new_course.lab = true;
            }
            batch.set(courseCollection.doc(courseId), new_course);
            currCourseInfo.lecture = true;
        }
        else if(new_course.type === 'Lab' && !currCourseInfo.lab) {
            if(currCourseInfo.lecture) {
                batch.set(courseCollection.doc(courseId), {lab: true}, {merge: true});
            }
            else {
                batch.set(courseCollection.doc(courseId), new_course);
            }
            currCourseInfo.lab = true;
        }

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
exports.loadDbChecksheets = async () => {
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
            abreviation: sheetInfo[0],
            major: sheetInfo[1],
            year: sheetInfo[2],
            school: sheetInfo[3],
            totalCredits: sheetInfo[4]
        }

        const checksheet_id = sheetInfo[0] + '-' + sheetInfo[2];
        await checksheetCollection.doc(checksheet_id).set(new_checksheet)
            .catch(function (error) {
                console.log("Could not load checksheet for " + checksheet_id, error);
            })

        var pathwaysIds = [];
        var pathways = [];         // Pathways for the checksheet
        // var electives = [];        // Categories of electives
        var course;
        var curr_course;
        var count = 0;
        var pathwayCount = 0;      //Counter variable to keep track of free of choice pathways
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


                        // Add semester to checksheet semester collection
                        await checksheetCollection.doc(checksheet_id).collection('semesters').doc('Semester ' + curr_semester).set({
                            semNum: curr_semester,
                            totalCredits: semester_credits,
                            semesterCourses: semester_courses
                        })
                            .catch(function (error) {
                                console.log("Could not load semester " + curr_semester, error);
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
                        var prerequisites = [];
                        var corequisites = [];

                        if (course[6].length !== 0)
                            prerequisites = course[6].split('&');

                        if (course[7].length !== 0)
                            corequisites = course[7].split('&');


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
                        if (course[8] !== '' && updated_course.type !== 'Lab') {
                            pathwaysIds.push(curr_course);
                            pathways.push({
                                courseId: curr_course,
                                name: updated_course.name,
                                type: course[8]
                            });
                        }
                    }
                }
                else if (course[8] === '0') {  // Course is a pathway
                    const pathwayId = "Pathway " + pathwayCount;
                    semester_courses.push({
                        courseId: pathwayId,
                        name: "Pathway",
                        credits: course[5]
                    });
                    pathwayCount++;
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

        await checksheetCollection.doc(checksheet_id).collection('semesters').doc('Semester ' + curr_semester).set({
            semNum: curr_semester,
            totalCredits: semester_credits,
            semesterCourses: semester_courses
        })
            .catch(function (error) {
                console.log("Could not load semester " + curr_semester, error);
            });


        // Add pathways to checksheet
        var updated_checksheet = new_checksheet;

        await checksheetCollection.doc(checksheet_id).get()
            .then(function (doc) {
                if (doc.exists)
                    updated_checksheet = doc.data();
                else
                    console.log("Checksheet doesn't exist.");
            })
            .catch(function (error) {
                console.log("Could not load checksheet for " + checksheet_id, error);
            });

        updated_checksheet.pathwayIds = pathwaysIds;
        updated_checksheet.pathways = pathways;

        await checksheetCollection.doc(checksheet_id).set(updated_checksheet)
            .catch(function (error) {
                console.log("Could not load checksheet for " + checksheet_id, error);
            })

    }

    console.log("Finished loading checksheets into db!");

}

/**
 *  Loads the database with pathways for all courses from directory: ./resources/pathways/
 */
exports.loadDbPathways = async () => {
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
            if (count == 500) {
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


/**
 * Autocomplete searches given a field and a prefix for that field in a provided collection.
 */
exports.autocompleteSearch = async (collection, field, prefix) => {

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
        .then(function (querySnapshot) {
            querySnapshot.forEach(function (doc) {
                queryResult.push(doc.data());
            });
        })
        .catch(function (error) {
            throw new Error("Failed to Query. ", error);
        })

    return queryResult;
}

/**
 * Autocomplete searchs given a field and a prefix for that field in a provided collection,
 *      while also ensuring that the first field provided matches the first search value.
 */
exports.autocompleteSearchSecond = async (collection, field1, search, field2, prefix) => {

    var strSearch = prefix;
    var strlength = strSearch.length;
    var strFrontCode = strSearch.slice(0, strlength - 1);
    var strEndCode = strSearch.slice(strlength - 1, strSearch.length);

    var startcode = strSearch;
    var endcode = strFrontCode + String.fromCharCode(strEndCode.charCodeAt(0) + 1);

    console.log(search + ' p' + prefix);

    const queryResult = [];
    await collection
        .where(field2, '>=', startcode)
        .where(field2, '<', endcode)
        .where(field1, '==', search)
        .get()
        .then(function (querySnapshot) {
            querySnapshot.forEach(function (doc) {
                queryResult.push(doc.data());
            });
        })
        .catch(function (error) {
            throw new Error("Failed to Query. ", error);
        })

    return queryResult;
}

/**
 * Loads static data into database as resources to be used later as reference.
 */
exports.loadStaticData = async () => {

    const majors = {
        'CS': 'Computer Science'
    };

    const schools = {
        'College of Engineering': ['CS']
    };

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

    // Load Ap equivalents
    const ap_equivalents = [];

    var apClasses = fs.readFileSync("./resources/AP2022.csv").toString('utf-8');
    const allEquivalents = apClasses.split('\n');

    var splitEquivalent = [];
    var equivalentId = 0;
    for (const equivalent of allEquivalents) {
        splitEquivalent = equivalent.split(',');
        var vtCourse = splitEquivalent[3] + '-' + splitEquivalent[4];
        var new_equivalent = {
            equivalentId: equivalentId,
            apAbreviation: splitEquivalent[0],
            apName: splitEquivalent[1],
            apScore: splitEquivalent[2],
            vtCourseId: vtCourse,
            vtCourseName: splitEquivalent[5]
        };

        ap_equivalents.push(new_equivalent);
        equivalentId++;

        if (splitEquivalent[6] !== '') {
            vtCourse = splitEquivalent[6] + '-' + splitEquivalent[7];

            new_equivalent = {
                equivalentId: equivalentId,
                apAbreviation: splitEquivalent[0],
                apName: splitEquivalent[1],
                apScore: splitEquivalent[2],
                vtCourseId: vtCourse,
                vtCourseName: splitEquivalent[5]
            };

            ap_equivalents.push(new_equivalent);
            equivalentId++;
        }
    }

    const staticData = {
        majors: majors,
        schools: schools,
        pathways: pathways,
        apEquivalents: ap_equivalents
    }

    console.log('Loading static resources...')
    await resoursesCollection.doc('static').set(staticData)
        .catch(function (error) {
            console.log('Failed to add static resources. ', error);
            throw new Error(error);
        });

    console.log('Finished loading static resources!');

}