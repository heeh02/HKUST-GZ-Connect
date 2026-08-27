# HKUST(GZ) Student Service Taxonomy

This document is the reviewed product source for the HKUST(GZ) Campus
Workspace catalogue. Classification follows the action a campus member
actually performs, not the system name or owning department.

## Classification rules

1. Every specialised system has exactly one primary task category.
2. `myPortal`, One-stop Service, and E-Form are cross-task gateways. They stay
   in the fixed gateway bar and are not repeated in catalogue categories.
3. Student-facing and staff-facing systems are separated. Inclusion does not
   imply that every account is authorised.
4. Search keywords may describe related actions, but must not silently change
   the primary category.
5. A stable official directory is preferred to a guessed or semester-specific
   deep link.
6. Custom Profiles inherit the category vocabulary only; they never inherit
   HKUST(GZ) URLs.

## Reviewed inventory

| ID | Entry | Actual primary use | Category | Audience |
| --- | --- | --- | --- | --- |
| official-portal | myPortal | Official application and information gateway | Gateway | All |
| one-stop | One-stop Service | Cross-task accommodation, campus-card, transport and IT requests | Gateway | All |
| e-form | E-Form | Cross-task leave, course, travel and administrative requests | Gateway | All |
| new-student | NSO | New-student registration and orientation tasks | New Student | Student |
| sis | SIS | Course selection, add/drop and course registration information | Courses & Exams | Student |
| ug-major-selection | UG Major Selection | Undergraduate major selection | Courses & Exams | Student |
| canvas | Canvas | Courses, learning material and assignments | Courses & Exams | Student |
| class-schedule | Class Schedule & Quota | Timetable and seat availability | Courses & Exams | Student |
| class-enrollment-request | Class Enrollment Request | Add, drop and course-enrolment requests | Courses & Exams | Student |
| academic-calendar | Academic Calendar | Terms, holidays and academic dates | Courses & Exams | All |
| academic-tools | Academic Systems & Tools | Official current academic-system directory | Courses & Exams | All |
| room-booking | Room Booking | Reserve classrooms, meeting rooms and study spaces | Campus Life | All |
| lims | LIMS | Reserve experiments, equipment and workbenches | Labs & Instruments | Student |
| instrument-sharing | Instrument Sharing | Instrument access, training and reservations | Labs & Instruments | All |
| rpms | RPMS | Research project application and management | Research & Computing | Research users |
| student-finance | SFS | Tuition, accommodation fees, scholarships and bills | Student Finance | Student |
| pbms | PBMS | Project budgets, research funds and reimbursement | Expenses & Procurement | Research/staff |
| e-tender | E-Tender | Procurement and tendering | Expenses & Procurement | Staff |
| career-center | Career Center | Internships, recruitment and career development | Career & Internships | Student |
| ug-credit-transfer | UG Credit Transfer | Credit-transfer reference and application support | Documents & Graduation | Student |
| thesis-exam | Thesis Exam | Thesis examination and graduation workflow | Documents & Graduation | Postgraduate |
| student-request-guide | Student Request Guide | Leave, program, personal-data and graduation request guidance | Documents & Graduation | Student |
| academic-edoc | Academic E-Doc | Testimonials, transcripts and enrolment documents | Documents & Graduation | Student |
| edoc-verification | E-Doc Verification | Verify University-issued electronic documents | Documents & Graduation | All |
| grade-reporting | Grade Reporting | Enter and submit grades | Staff Tools | Teaching staff |
| exam-scheduling | Exam Scheduling | Arrange examinations | Staff Tools | Authorised staff |
| library | Library | Collections, databases and general study/research resources | General Tools | All |
| outlook | Outlook | Email and calendar | General Tools | All |
| itd | ITD | Account, network, campus-card, printing and software guidance | General Tools | All |
| home | University Homepage | Public University information | General Tools | All |

## Stable categories

- Gateway
- New Student
- Courses & Exams
- Research & Computing
- Labs & Instruments
- Student Finance
- Expenses & Procurement
- Career & Internships
- Campus Life
- Documents & Graduation
- General Tools
- Staff Tools
- Custom

## Primary official evidence

- Academic Registry Systems & Tools:
  <https://ars.hkust-gz.edu.cn/systems-tools/>
- Academic Registry Student Services:
  <https://ars.hkust-gz.edu.cn/student-services/>
- One-stop Service catalogue:
  <https://onestopservice.hkust-gz.edu.cn/service-items/online-service/>
- Student Finance System handbook:
  <https://onestopservice.hkust-gz.edu.cn/zh/wp-content/uploads/sites/2/2024/02/SFS-Handbook-%E5%AD%A6%E7%94%9F%E8%B4%A2%E5%8A%A1%E7%B3%BB%E7%BB%9F%E6%89%8B%E5%86%8C.pdf>
- Undergraduate LIMS guide:
  <https://ugtl.hkust-gz.edu.cn/wp-content/uploads/2024/08/LIMS-Guidebook-for-UG-ver.02.pdf>
- Instrument Sharing Platform guidance:
  <https://instrumentsharelab.hkust-gz.edu.cn/Article/Show/cd2d214f-236d-4236-8c39-587273c65955>
- Research Department:
  <https://rd.hkust-gz.edu.cn/about/>
- Career Center:
  <https://careercenter.hkust-gz.edu.cn/zh/home/>

## Maintenance gate

Before changing a reviewed entry, verify its actual task, audience, canonical
URL, route, localisation and source. Dynamic SSO callbacks and semester URLs
must never be stored as reviewed resources. Changes to this table and the
Profile resource asset must be reviewed together.
