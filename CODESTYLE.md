# Smart City Booking - Code Style Guide

This document outlines the coding patterns and standards to be followed in the Smart City Booking backend project. The code structure follows a consistent pattern across different domain entities (e.g., bookings, users, roles).

## Directory Structure

```
src/
├── commons/
│   ├── data-managers/
│   │   ├── models/
│   │   │   ├── entityModel.js
│   │   ├── entity-manager.js
│   ├── entities/
│   │   ├── entity/
│   │   │   ├── entity.js
│   │   │   ├── entityHook.js
│   ├── schemas/
│   │   ├── entitySchema.js
```

## Entity Pattern

Each domain entity should follow this pattern:

### 1. Schema Definition (`src/commons/schemas/entitySchema.js`)

```javascript
const { Double } = require("mongodb");

const entityHookSchemaDefinition = {
  id: { type: String, required: true },
  type: { type: String, required: true },
  timeCreated: { type: Double, default: () => Date.now() },
  payload: { type: Object, default: {} },
};

const entitySchemaDefinition = {
  id: { type: String, required: true },
  // Entity-specific fields
  hooks: { type: [entityHookSchemaDefinition], default: [] },
};

module.exports = {
  entitySchemaDefinition,
  entityHookSchemaDefinition,
};
```

### 2. Entity Hook (`src/commons/entities/entity/entityHook.js`)

```javascript
const { v4: uuidv4 } = require("uuid");
const SchemaUtils = require("../../utilities/schemaUtils");
const { entityHookSchemaDefinition } = require("../../schemas/entitySchema");

const ENTITY_HOOK_TYPES = Object.freeze({
  // Define hook types here
});

class EntityHook {
  constructor(params = {}) {
    const defaults = SchemaUtils.createDefaults(entityHookSchemaDefinition);
    Object.assign(this, defaults, params);
  }

  validate() {
    SchemaUtils.validate(this, entityHookSchemaDefinition);
    return true;
  }

  static create(params) {
    const hook = new EntityHook({
      id: uuidv4(),
      timeCreated: Date.now(),
      ...params,
    });
    hook.validate();
    return hook;
  }
}

module.exports = {
  EntityHook,
  ENTITY_HOOK_TYPES,
};
```

### 3. Main Entity (`src/commons/entities/entity/entity.js`)

```javascript
const { entitySchemaDefinition } = require("../../schemas/entitySchema");
const SchemaUtils = require("../../utilities/schemaUtils");
const { EntityHook, ENTITY_HOOK_TYPES } = require("./entityHook");

class Entity {
  constructor(params = {}) {
    const defaults = SchemaUtils.createDefaults(entitySchemaDefinition);
    Object.assign(this, defaults, params);

    // Convert hooks to EntityHook entities
    if (this.hooks && Array.isArray(this.hooks)) {
      this.hooks = this.hooks.map((hook) =>
        hook instanceof EntityHook ? hook : new EntityHook(hook),
      );
    }
  }

  // Entity-specific methods

  addHook(type, payload) {
    const hook = EntityHook.create({ type, payload });
    this.hooks.push(hook);
    return hook;
  }

  validate() {
    SchemaUtils.validate(this, entitySchemaDefinition);
    return true;
  }

  static create(params) {
    const entity = new Entity(params);
    entity.validate();
    return entity;
  }
}

module.exports = {
  Entity,
  ENTITY_HOOK_TYPES,
};
```

### 4. Model (`src/commons/data-managers/models/entityModel.js`)

```javascript
const mongoose = require("mongoose");
const { entitySchemaDefinition } = require("../../schemas/entitySchema");
const { Schema } = mongoose;

const EntitySchema = new Schema(entitySchemaDefinition);

// Add middleware if needed
EntitySchema.pre(
  "deleteOne",
  { document: false, query: true },
  async function (next) {
    // Cleanup logic
    next();
  },
);

EntitySchema.methods.toEntity = function () {
  const { Entity } = require("../../entities/entity/entity");
  return new Entity(this.toObject());
};

module.exports =
  mongoose.models.Entity || mongoose.model("Entity", EntitySchema);
```

### 5. Manager (`src/commons/data-managers/entity-manager.js`)

```javascript
const { Entity, ENTITY_HOOK_TYPES } = require("../entities/entity/entity");
const EntityModel = require("./models/entityModel");

class EntityManager {
  /**
   * Get a specific entity
   * @param {string} id Entity ID
   * @param {string} [tenantId] Tenant ID if applicable
   * @returns {Promise<Entity|null>} Entity or null
   */
  static async getEntity(id, tenantId) {
    const query = { id: id };
    if (tenantId) query.tenantId = tenantId;

    const rawEntity = await EntityModel.findOne(query);
    if (!rawEntity) return null;

    return rawEntity.toEntity();
  }

  /**
   * Store an entity (create or update)
   * @param {Entity|Object} entity Entity to store
   * @param {boolean} upsert Whether to create if not exists
   * @returns {Promise<Entity>} The stored entity
   */
  static async storeEntity(entity, upsert = true) {
    // Ensure we have an Entity instance
    const entityInstance =
      entity instanceof Entity ? entity : new Entity(entity);

    // Validate before storing
    entityInstance.validate();

    await EntityModel.updateOne({ id: entityInstance.id }, entityInstance, {
      upsert: upsert,
    });

    return entityInstance;
  }

  /**
   * Get all entities
   * @returns {Promise<Entity[]>} List of entities
   */
  static async getEntities() {
    const rawEntities = await EntityModel.find({});
    return rawEntities.map((doc) => doc.toEntity());
  }

  /**
   * Remove an entity
   * @param {string} id Entity ID
   * @returns {Promise<void>}
   */
  static async removeEntity(id) {
    await EntityModel.deleteOne({ id: id });
  }
}

module.exports = EntityManager;
```

## Coding Standards

### Naming Conventions

1. **Files and Directories**:

   - Use kebab-case for file and directory names: `entity-manager.js`, `user-hook.js`
   - Entity directories should be singular: `user/` not `users/`

2. **Classes**:

   - Use PascalCase for class names: `UserManager`, `BookingHook`
   - Manager classes should end with "Manager": `UserManager`, `BookingManager`
   - Model classes should end with "Model": `UserModel`, `BookingModel`

3. **Methods and Functions**:

   - Use camelCase for method and function names: `getUser()`, `storeBooking()`
   - Getter methods should start with "get": `getUser()`, `getBookings()`
   - Setter methods should start with "set", "store", "update", etc.: `storeUser()`, `updateBooking()`

4. **Constants**:
   - Use UPPER_SNAKE_CASE for constants: `USER_HOOK_TYPES`

### Documentation

1. **Class Documentation**:

   Document classes with JSDoc comments that include:

   - Description
   - Author (optional)

   Example:

   ```
   /**
    * Data Manager for User objects.
    *
    * @author John Doe, john.doe@example.com
    */
   ```

2. **Method Documentation**:

   Document methods with JSDoc comments that include:

   - Description
   - Parameters with types and descriptions
   - Return value with type and description

   Example:

   ```
   /**
    * Get a specific user
    * @param {string} id User ID
    * @param {boolean} [withSensitive=false] Whether to include sensitive data
    * @returns {Promise<User|null>} User or null
    */
   ```

### Code Organization

1. **Imports**:

   - Required modules first
   - Local imports second
   - Separate with a blank line

2. **Exports**:

   - Use named exports for multiple exports
   - Use module.exports for single exports

3. **Error Handling**:

   - Use try/catch blocks for async operations
   - Propagate errors with meaningful messages

4. **Validation**:
   - Validate entities before storing them
   - Use SchemaUtils for validation

## Example Implementation

See the following files for reference implementations:

- User Entity: `src/commons/entities/user/user.js`
- User Hook: `src/commons/entities/user/userHook.js`
- User Schema: `src/commons/schemas/userSchema.js`
- User Model: `src/commons/data-managers/models/userModel.js`
- User Manager: `src/commons/data-managers/user-manager.js`

- Booking Entity: `src/commons/entities/booking/booking.js`
- Booking Hook: `src/commons/entities/booking/bookingHook.js`
- Booking Schema: `src/commons/schemas/bookingSchema.js`
- Booking Model: `src/commons/data-managers/models/bookingModel.js`
- Booking Manager: `src/commons/data-managers/booking-manager.js`
