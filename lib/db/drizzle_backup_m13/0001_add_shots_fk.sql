ALTER TABLE "shots" DROP CONSTRAINT IF EXISTS "fk_shots_script_id";
ALTER TABLE "shots" ADD CONSTRAINT "fk_shots_script_id" FOREIGN KEY ("script_id") REFERENCES "scripts"("id") ON DELETE CASCADE;
