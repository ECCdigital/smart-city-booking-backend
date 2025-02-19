const fs = require('fs');
const path = require('path');

const mongoose = require('mongoose');

const migrationSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
  },
  executedAt: {
    type: Date,
    default: Date.now,
  }
});

const Migration = mongoose.model('Migration', migrationSchema);


function loadMigrations() {
  const migrationsDir = path.join(__dirname, '/scripts');
  const files = fs.readdirSync(migrationsDir);

  const migrationFiles = files.filter((file) => file.endsWith('.js'));


  const migrations = migrationFiles.map((file) => {
    const migrationPath = path.join(migrationsDir, file);
    const migration = require(migrationPath);

    return {
      name: migration.name,
      up: migration.up,
      down: migration.down,
    };
  });


  migrations.sort((a, b) => {
    const [dayA, monthA, yearA] = a.name.split('-');
    const [dayB, monthB, yearB] = b.name.split('-');

    const dateA = new Date(+yearA, +monthA - 1, +dayA);
    const dateB = new Date(+yearB, +monthB - 1, +dayB);

    return dateA - dateB;
  });

  return migrations;
}

async function runMigrations(mongoose) {
  const allMigrations = loadMigrations();

  const executedMigrations = await Migration.find({}, { name: 1, _id: 0 });
  const executedNames = executedMigrations.map((m) => m.name);

  for (const migration of allMigrations) {
    if (!executedNames.includes(migration.name)) {
      console.log(`Starte Migration: ${migration.name}`);
      await migration.up(mongoose);

      await Migration.create({ name: migration.name });
      console.log(`Migration completed : ${migration.name}`);
    }
  }

  console.log('All migrations completed');
}


async function rollbackMigrations(mongoose, name) {
  const allMigrations = loadMigrations().reverse();

  if (name) {
    const migration = allMigrations.find((m) => m.name === name);
    if (migration && migration.down) {
      await migration.down(mongoose);
      await Migration.deleteOne({ name: migration.name });
      console.log(`Migration restored ${migration.name}`);
    } else {
      console.log(`Migration not found: ${name}`);
    }
    return;
  }

  for (const migration of allMigrations) {
    const executed = await Migration.findOne({ name: migration.name });
    if (executed && migration.down) {
      console.log(`Reset migration ${migration.name}`);
      await migration.down(mongoose);
      await Migration.deleteOne({ name: migration.name });
      console.log(`Migration rested: ${migration.name}`);
    }
  }
}

module.exports = {
  runMigrations,
  rollbackMigrations,
};
