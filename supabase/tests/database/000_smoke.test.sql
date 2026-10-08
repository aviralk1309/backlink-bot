begin;
select plan(2);
select has_extension('pgcrypto', 'pgcrypto extension installed');
select has_extension('pg_trgm', 'pg_trgm extension installed');
select * from finish();
rollback;
