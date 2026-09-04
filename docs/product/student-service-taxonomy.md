# HKUST(GZ) Student Service Taxonomy and Route Catalogue

This is the reviewed product contract for the HKUST(GZ) Campus Workspace catalogue.
The runtime source of truth for names, canonical URLs, search keywords, primary categories,
and routes is `desktop/assets/profiles/hkustgz/builtin-resources.json`.

Last reviewed: 2026-08-31

## Product rules

1. Classify by the task a student is trying to finish, not by the owning office.
2. Give every site one primary category. Undergraduate, postgraduate, MPhil, PhD, and
   task vocabulary belong in search keywords instead of duplicate resources.
3. Keep myPortal, One-stop, and E-Form as cross-task gateways. They stay in the fixed
   gateway area and are not repeated in catalogue categories.
4. Keep research progress, thesis examination, AIGC, and HPC together for MPhil and PhD
   users. Keep student fees/PGS separate from project budgets and reimbursement.
5. Prefer a stable system root or official directory over an SSO callback, token, form
   state, or semester-specific deep link.
6. Custom Profiles inherit the category vocabulary only; they never inherit HKUST(GZ)
   resources or routes.

## Stable category order

1. Courses, enrollment & grades
2. Research, progress & computing
3. Labs & instruments
4. Fees, aid & studentships
5. Funding, procurement & expenses
6. Applications, documents & graduation
7. Housing & spaces
8. Internships, career & development
9. Collaboration, library & IT
10. Onboarding & account
11. Teaching & administration
12. Custom

## Reviewed coverage matrix

Evidence classes:

- `direct-entry-verified`: the stable entry point was reachable through public DNS and an
  off-campus physical-interface TLS/HTTP request, a public fetch, or an authoritative
  third-party host. This does not claim every post-login workflow was completed.
- `observed-tunnel-required`: the physical path failed while the EasyConnect path completed.
- `conservative-tunnel`: a sensitive authenticated workflow lacks complete off-campus
  dependency evidence, so the safe reviewed default remains Campus Tunnel.

| ID | Primary task | Audience | Route | Evidence |
| --- | --- | --- | --- | --- |
| `official-portal` | cross-task official application gateway | all | Direct | direct-entry-verified |
| `one-stop` | accommodation, campus card, transport, activity and IT requests | all | Direct | direct-entry-verified |
| `e-form` | leave, course, travel and administrative requests | all | Direct | direct-entry-verified |
| `sis` | course selection, add/drop and registration | students | Direct | direct-entry-verified |
| `klms` | module selection and module grades | postgraduate students | Direct | direct-entry-verified |
| `ug-major-selection` | undergraduate major selection | undergraduate students | Direct | direct-entry-verified |
| `ug-credit-transfer` | undergraduate credit-transfer records | undergraduate students | Direct | direct-entry-verified |
| `canvas` | courses, learning material and assignments | students | Direct | direct-entry-verified |
| `class-schedule` | timetable and seat availability | students | Direct | direct-entry-verified |
| `final-exam-schedule` | examination dates, times and venues | students | Direct | direct-entry-verified |
| `class-enrollment-request` | add/drop and enrolment requests | students | Direct | direct-entry-verified |
| `academic-calendar` | terms, holidays and academic dates | all | Direct | direct-entry-verified |
| `academic-tools` | official academic-system directory | all | Direct | direct-entry-verified |
| `thesis-exam` | thesis review, examination and defence | MPhil/PhD | Direct | direct-entry-verified |
| `rpms` | research project application and management | research users | Campus Tunnel | conservative-tunnel |
| `annual-progress` | annual research progress reporting | MPhil/PhD | Direct | direct-entry-verified |
| `quarterly-progress` | quarterly PhD progress evaluation | PhD | Direct | direct-entry-verified |
| `aigc` | University AI model services | all | Direct | direct-entry-verified |
| `hpc-docs` | HPC, scheduling, storage and AIGC documentation | research users | Direct | direct-entry-verified |
| `hpc-login` | HPC2 login and interactive computing | research users | Campus Tunnel | observed-tunnel-required |
| `lims` | experiment, equipment and workbench booking | laboratory users | Campus Tunnel | observed-tunnel-required |
| `instrument-sharing` | instrument access, training and reservation | laboratory users | Direct | direct-entry-verified |
| `student-finance` | tuition, accommodation fees, PGS and bills | students | Direct | direct-entry-verified |
| `student-aid` | scholarships, aid and work-study | students | Direct | direct-entry-verified |
| `pbms` | project budgets, research funds and reimbursement | research/staff | Campus Tunnel | conservative-tunnel |
| `e-tender` | procurement and tendering | authorised staff | Campus Tunnel | conservative-tunnel |
| `student-request-guide` | leave, transfer and personal-data request guidance | students | Direct | direct-entry-verified |
| `rpg-handbook` | RPg study, APR/QPE, PGS and thesis rules | MPhil/PhD | Direct | direct-entry-verified |
| `pg-graduation-guide` | postgraduate graduation and thesis deadlines | postgraduate students | Direct | direct-entry-verified |
| `academic-edoc` | transcripts, testimonials and enrolment documents | students | Direct | direct-entry-verified |
| `edoc-verification` | verification of University-issued documents | all | Direct | direct-entry-verified |
| `student-dorm` | dormitory/college selection and room records | students | Direct | direct-entry-verified |
| `room-booking` | classroom, meeting-room and study-space booking | all | Direct | direct-entry-verified |
| `career-center` | internships, recruitment and career development | students | Direct | direct-entry-verified |
| `library` | collections, databases and study/research resources | all | Direct | direct-entry-verified |
| `microsoft-365` | Microsoft 365 application hub | all | Direct | direct-entry-verified |
| `onedrive-sharepoint` | files and team document collaboration | all | Direct | direct-entry-verified |
| `teams` | chat, meetings and course/research collaboration | all | Direct | direct-entry-verified |
| `outlook` | email and calendar | all | Direct | direct-entry-verified |
| `itd` | account, network, campus-card, printing and software guidance | all | Direct | direct-entry-verified |
| `home` | public University information | all | Direct | direct-entry-verified |
| `new-student` | registration and orientation tasks | new students | Direct | direct-entry-verified |
| `my-account` | account password management | all | Direct | direct-entry-verified |
| `exam-scheduling` | examination arrangement | authorised staff | Direct | direct-entry-verified |
| `grade-reporting` | grade entry and submission | teaching staff | Direct | direct-entry-verified |

The matrix covers all 45 reviewed resources exactly once: 40 Direct and 5 Campus Tunnel.
The exact URL and localized copy remain single-sourced in the reviewed JSON asset instead
of being duplicated here.

## Route precedence and consumers

The shared order is:

1. private/local safety boundary;
2. user exact and suffix rules;
3. custom exact websites;
4. reviewed exact resource routes;
5. generic partner/school suffixes;
6. inherited or safe default.

The Campus Browser resolver, its PAC, and Clash/Mihomo export use this order. Reviewed
Direct SSO dependencies (`sso.hkust-gz.edu.cn`, `gzcas.hkust-gz.edu.cn`) override the
generic school suffix. Microsoft 365, SharePoint, Teams, Outlook, and Canvas dependencies
are also Direct. HTTP(S) and WebSocket requests share the same decision.

## Source coverage boundary

- The myPortal student and PC App Centers are SSO-protected. This review cross-checks their
  public entry points against the University's ARS, FYTGS, IT, SSFA, and service guides.
  A signed-in App Center reconciliation remains a release/term audit item; the current
  matrix must not be described as proof that no authenticated-only tile exists.
- One-stop is intentionally one gateway instead of dozens of fragile form-state links.
  Campus-card, dormitory, visitor, vehicle, security, IT, and feedback tasks remain
  searchable through its keywords and open inside the official service hall.

## Primary official evidence

- [myPortal student App Center](https://myportal.hkust-gz.edu.cn/#/appCenterStu)
- [myPortal PC App Center](https://myportal.hkust-gz.edu.cn/#/appCenterPc)
- [One-stop Online Service Hall](https://onestop-online.hkust-gz.edu.cn/)
- [ARS Systems & Tools](https://ars.hkust-gz.edu.cn/systems-tools/)
- [ARS Student Services](https://ars.hkust-gz.edu.cn/student-services/)
- [Research Postgraduate Handbook](https://fytgs.hkust-gz.edu.cn/handbooks/handbook-for-research-postgraduate-studies)
- [PG Graduation Guide](https://ars.hkust-gz.edu.cn/graduation/pg-graduation-guide/)
- [IT Survival Guideline for Students](https://itdid.hkust-gz.edu.cn/uploadfile/2025/07/17/15-46-49/IT%20Survival%20Guideline%20for%20Students.pdf)
- [One-stop service guideline](https://itdid.hkust-gz.edu.cn/uploadfile/2025/06/04/10-23-22/%E4%B8%80%E7%AB%99%E5%BC%8F%E7%BA%BF%E4%B8%8A%E5%8A%9E%E4%BA%8B%E5%A4%A7%E5%8E%85%EF%BC%88%E8%8B%B1%E6%96%87%EF%BC%89.pdf)

## Maintenance gate

1. Recheck official App Center and handbook links before each release and at least once
   per academic term.
2. Never persist a transient SSO callback, token, form state, or term-specific redirect.
3. Change `conservative-tunnel` to Direct only after the application and its authentication
   and dependency chain have been verified off campus.
4. Remove or redirect retired aliases while preserving resource IDs so favourites, recent
   activity, and user collections survive.
5. Run catalogue contract tests, reviewed-resource resolver/PAC parity, Clash/Mihomo order,
   upgrade compatibility, and all three platform package verifiers after any change.
