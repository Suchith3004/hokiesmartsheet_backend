
# HokieSmartSheet

The primary goal for this project is to develop a more reliable substitute for the Degree Audit Report System (DARS) that Virginia Tech is currently using. Moreover, we also want to provide students at Virginia Tech the opportunity to find mentors to receive help with school related questions.

This application will allow undergraduate students at Virginia Tech to create and organize their major and minor checksheets/plan. Users can use a tech tree with drag and drop items to easily add, rearrange, and remove classes as they choose. The application will assist in helping students also determine when or in what order to take classes, through corequisite and prerequisite checks. Users are free to make any choice, we will simply advise them in their choices.

Additionally, students will have access to experienced mentors from VT’s clubs and organizations in their planning process. In the form of an in-app chat, students can utilize their mentors to plan their tech tree or simply ask for college advice. In-app access to mentors will also allow users to easily share and edit their plan interactively.

Although we provide users with access to a base collection of classes for their respective major, we will not be able to provide all graduation requirements. Since we do not have access to Virginia Tech’s course and checksheet database, we can only provide information that is verified and publicly available. *** Currently only one major are supported in development: Computer Science.



## Tech Stack

**Client:** React, [Expo](https://expo.dev/), Firebase (Authentication)

**Server:** Firebase (Functions, Firestore, Chat), Node.js


## Deployment

Clone the project

```bash
  git clone https://github.com/SuddalaS/hokiesmartsheet_backend.git
```

Go to the project directory

```bash
  cd hokiesmartsheet_backend
```

Install dependencies

```bash
  npm install
```

Login into Firebase
```bash
  firebase login
```

To deploy the Firebase lambda functions (32 available):

```bash
  firebase deploy --only functions
```


## Run Locally

Clone the project

```bash
  git clone https://github.com/SuddalaS/hokiesmartsheet_backend.git
```

Go to the project directory

```bash
  cd hokiesmartsheet_backend
```

Install dependencies

```bash
  npm install
```

Login into Firebase
```bash
  firebase login
```

To deploy the Firebase lambda functions (32 available):

```bash
  firebase emulators:start
```



## Authors

- Suchith Suddala - [@suchith3004](https://github.com/Suchith3004)
- Keith Kelly - [@kdkelly](https://github.com/kdkelley)



## Screenshots

**Checksheet:**
![Checksheet](https://drive.google.com/uc?export=view&id=1x10Q6f4p1mK9Qhbi6EFVW1Hc4rmVsq6B)
![Checksheet](https://drive.google.com/uc?export=view&id=1zwfv2i7TYZ9dDQmhc3I4yV44hBaVHIUM)


**Course Information**
![Course Info](https://drive.google.com/uc?export=view&id=1ZFWmnPK4lSu4loqbT7Cmvebe_2FxVVGN)


**AP/Transfer**
![AP-Transfer](https://drive.google.com/uc?export=view&id=1qauRHPWZ_c3-zjMkKmLE_IgNrnUNBwAa)


**Pathway**
![Pathway-Search](https://drive.google.com/uc?export=view&id=1t2dodHqjz1Bo7ppe0d31rUWFRTcsafep)

![Pathway-View](https://drive.google.com/uc?export=view&id=1D4A4vZ3CKWdwNm4Yq_Q08U4S_zWbnusy)


**Mentor**
![Mentor-Search](https://drive.google.com/uc?export=view&id=1AyyQ5T7BOcaIZbDR040rmvROI3g3BjWL)

![Mentor-Requests](https://drive.google.com/uc?export=view&id=1V3shjCsHRazakYB2x4bTIHtSqAxoSMrm)


**Share Checksheets with Mentor**
![Share-Checksheet](https://drive.google.com/uc?export=view&id=1pj21NrZeWUG9C2Rr9NjjrAaDlJiddith)


**Mentor Chat**
![Mentor Chat](https://drive.google.com/uc?export=view&id=1AusqitdIM-ZtvqzGXhWboGY75QBUIHnD)

