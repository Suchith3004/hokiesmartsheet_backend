/**
 * Cleans course, by adding the prefix, to prepare for return.
 * @param {*} course - course object from firebase db
 * @param {*} prefix - the document id for course (abbreviation-number)
 */
exports.cleanCourse = (course, prefix) => {

    course.abbreviation = prefix.split('-')[0];
    course.number = prefix.split('-')[1];
    return course;

};


