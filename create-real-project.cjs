const { db, projectsTable, shotsTable } = require('./lib/db/dist/index.js');

async function main() {
  try {
    const [project] = await db.insert(projectsTable).values({
      title: "Nashash Real Production Project",
      worldId: "world_01",
      synopsis: "Real test production pipeline",
      projectType: "film",
      style: "drama",
      status: "production"
    }).returning();

    await db.insert(shotsTable).values([
      {
        projectId: project.id,
        sceneNumber: "1",
        shotOrder: 1,
        description: "Opening Shot",
        cameraMovement: "Pan",
        durationSeconds: 2,
        audioStatus: "COMPLETED"
      }
    ]);

    console.log("Real Project Created ID:", project.id);
    process.exit(0);
  } catch (err) {
    console.error("DB Insert Error:", err);
    process.exit(1);
  }
}

main();
