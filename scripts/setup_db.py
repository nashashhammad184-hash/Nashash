import urllib.parse
import os

with open(".env", "r") as f:
    lines = f.readlines()

db_url = None
for line in lines:
    line = line.strip()
    if line.startswith("DATABASE_URL="):
        db_url = line.split("=", 1)[1].strip().strip('"').strip("'")
        break

if not db_url:
    print("❌ لم يتم العثور على DATABASE_URL في .env")
    exit(1)

u = urllib.parse.urlparse(db_url)
user = urllib.parse.unquote(u.username or "postgres")
password = urllib.parse.unquote(u.password or "")
dbname = urllib.parse.unquote(u.path.lstrip("/") or "nashash")

print(f"⚙️ جاري ضبط المستخدم [{user}] وقاعدة البيانات [{dbname}]...")

# 1. إنشاء وضبط كلمة مرور المستخدم
sql_user = f"""
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '{user}') THEN
    CREATE ROLE "{user}" WITH SUPERUSER LOGIN PASSWORD '{password}';
  ELSE
    ALTER ROLE "{user}" WITH PASSWORD '{password}';
  END IF;
END
$$;
"""
os.system(f'sudo -u postgres psql -c "{sql_user}"')

# 2. إنشاء قاعدة البيانات إن لم تكن موجودة
os.system(f'sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname = \'{dbname}\'" | grep -q 1 || sudo -u postgres createdb -O "{user}" "{dbname}"')

print("✅ تم إعداد المستخدم وقاعدة البيانات بنجاح تام!")
