const fs = require("fs");
const path = require("path");

const mongoose = require("mongoose");

const { withMigrationLock } = require("./lib/migration-lock");

const migrationSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
  },
  executedAt: {
    type: Date,
    default: Date.now,
  },
});

const Migration = mongoose.model("Migration", migrationSchema);

// The single lock document of the runner, see `lib/migration-lock.js`.
const migrationLockSchema = new mongoose.Schema({
  _id: String,
  owner: { type: String, required: true },
  acquiredAt: Date,
  heartbeatAt: Date,
  expiresAt: { type: Date, required: true },
});

const MigrationLock = mongoose.model("MigrationLock", migrationLockSchema);

function loadMigrations() {
  const migrationsDir = path.join(__dirname, "/scripts");
  const files = fs.readdirSync(migrationsDir);

  const migrationFiles = files.filter((file) => file.endsWith(".js"));

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
    const [dayA, monthA, yearA] = a.name.split("-");
    const [dayB, monthB, yearB] = b.name.split("-");

    const dateA = new Date(+yearA, +monthA - 1, +dayA);
    const dateB = new Date(+yearB, +monthB - 1, +dayB);

    return dateA - dateB;
  });

  return migrations;
}

/**
 * Run every migration that is not recorded yet, one runner at a time.
 *
 * The run holds the migration lock. A runner that finds the lock held waits
 * for it and reads the recorded migrations only once it holds the lock
 * itself, so it never repeats what the other runner did; it fails when the
 * lock is still held after the wait timeout.
 *
 * @param {Object} mongoose The connection handed to the migration scripts
 * @param {Object} [options] Lock timing (`leaseMs`, `pollMs`,
 *   `waitTimeoutMs`; default: `MIGRATION_LOCK_*` of the environment) and the
 *   seams of the tests (`migrations`, `migrationModel`, `lockModel`,
 *   `ownerId`, `logger`)
 * @returns {Promise<void>}
 */
async function runMigrations(mongoose, options = {}) {
  const allMigrations = options.migrations ?? loadMigrations();
  const migrationModel = options.migrationModel ?? Migration;
  const lockModel = options.lockModel ?? MigrationLock;
  const logger = options.logger ?? console;

  await withMigrationLock(lockModel, options, async ({ assertHeld }) => {
    const executedMigrations = await migrationModel.find(
      {},
      { name: 1, _id: 0 },
    );
    const executedNames = executedMigrations.map((m) => m.name);

    for (const migration of allMigrations) {
      if (!executedNames.includes(migration.name)) {
        assertHeld();
        logger.log(`Starte Migration: ${migration.name}`);
        await migration.up(mongoose);

        await migrationModel.create({ name: migration.name });
        logger.log(`Migration completed : ${migration.name}`);
      }
    }
  });

  logger.log("All migrations completed");
}

/**
 * Roll back one migration by name, or every recorded one in reverse order.
 * Holds the migration lock like {@link runMigrations}.
 */
async function rollbackMigrations(mongoose, name) {
  await withMigrationLock(MigrationLock, {}, () =>
    rollbackUnderLock(mongoose, name),
  );
}

async function rollbackUnderLock(mongoose, name) {
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
