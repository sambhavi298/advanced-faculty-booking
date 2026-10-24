# Bulk timetable import

Loads class timetables and faculty office hours from CSV in one transaction.

```bash
cd database/import
psql "$DATABASE_URL" -f import-timetable.sql                         # uses classes.csv + office_hours.csv
psql "$DATABASE_URL" -v classes=my.csv -v office=none -f import-timetable.sql   # classes only
psql "$DATABASE_URL" -v office=my-hours.csv -v classes=none -f import-timetable.sql   # office hours only
psql "$DATABASE_URL" -v replace=off -f import-timetable.sql          # add rows, keep existing ones
```

`classes.csv` columns: `department_code, academic_year, year_of_study, batch_name, course_code,
course_title, session_type (LECTURE|LAB|TUTORIAL), day_of_week (1=Mon..7=Sun), start_time, end_time,
room, faculty_login_id` (leave the teacher empty if unassigned). Batches that do not exist are created.

`office_hours.csv` columns: `faculty_login_id, day_of_week, start_time, end_time` (5-minute marks).

By default the file **replaces** the timetable of every batch / faculty member it mentions.
Every problem is reported with its CSV line number and nothing is written if there is any: unknown
department or faculty, bad times or days, overlapping classes in one batch, a teacher in two
classes at once (inside the file or against other batches already in the database), overlapping
office hours. The `WITHOUT OVERLAPS` constraints stay in place as the final safety net.

Advanced SQL used: temp staging tables, set-based validation with `LATERAL`/`VALUES`, range-style
overlap self-joins, data-modifying CTEs with `RETURNING` counts, `INSERT ... ON CONFLICT DO NOTHING`,
a single transaction, `\gset`/`\gexec` for control flow.
