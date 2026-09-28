-- Runs once, the first time the `db` container initialises an empty data volume.
-- Integration tests use their own database so they can never touch development data.
CREATE DATABASE advanced_faculty_booking_test;
