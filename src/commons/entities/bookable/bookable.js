const { bookableSchemaDefinition } = require("../../schemas/bookableSchema");
const SchemaUtils = require("../../utilities/schemaUtils");
const {
  absoluteUrl,
  enrichAttachment,
  enrichMediaReferences,
  mediaReferenceUrl,
} = require("../../services/media/media-reference");
const {
  validateBlockPeriods,
  validateBookingModeExclusivity,
} = require("../../utilities/block-period-validation");

const BOOKABLE_TYPES = Object.freeze({
  EVENT_LOCATION: "event-location",
  ROOM: "room",
  RESOURCE: "resource",
  TICKET: "ticket",
});

const PRICE_TYPES = Object.freeze({
  PER_HOUR: "per-hour",
  PER_DAY: "per-day",
  PER_ITEM: "per-item",
  PER_SQUARE_METER: "per-square-meter",
});

class Bookable {
  constructor(params = {}) {
    const defaults = SchemaUtils.createDefaults(bookableSchemaDefinition);
    const allowedKeys = Object.keys(bookableSchemaDefinition);
    const filteredParams = Object.fromEntries(
      Object.entries(params).filter(([key]) => allowedKeys.includes(key)),
    );

    Object.assign(this, defaults, filteredParams);

    this.customFields = params.customFields || undefined;

    // Update timestamp on modification
    this.timeUpdated = Date.now();
  }

  /**
   * Add a tag to the bookable
   * @param {string} tag Tag name
   */
  addTag(tag) {
    if (!this.tags.includes(tag)) {
      this.tags.push(tag);
      this.timeUpdated = Date.now();
    }
  }

  /**
   * Remove a tag from the bookable
   * @param {string} tag Tag name
   */
  removeTag(tag) {
    const initialLength = this.tags.length;
    this.tags = this.tags.filter((t) => t !== tag);
    if (this.tags.length !== initialLength) {
      this.timeUpdated = Date.now();
    }
  }

  /**
   * Add a flag to the bookable
   * @param {string} flag Flag name
   */
  addFlag(flag) {
    if (!this.flags.includes(flag)) {
      this.flags.push(flag);
      this.timeUpdated = Date.now();
    }
  }

  /**
   * Remove a flag from the bookable
   * @param {string} flag Flag name
   */
  removeFlag(flag) {
    const initialLength = this.flags.length;
    this.flags = this.flags.filter((f) => f !== flag);
    if (this.flags.length !== initialLength) {
      this.timeUpdated = Date.now();
    }
  }

  /**
   * Add an attachment to the bookable
   * @param {Object} attachment Attachment object
   */
  addAttachment(attachment) {
    this.attachments.push(attachment);
    this.timeUpdated = Date.now();
  }

  /**
   * Remove an attachment from the bookable
   * @param {string} attachmentId Attachment ID
   */
  removeAttachment(attachmentId) {
    const initialLength = this.attachments.length;
    this.attachments = this.attachments.filter((a) => a.id !== attachmentId);
    if (this.attachments.length !== initialLength) {
      this.timeUpdated = Date.now();
    }
  }

  /**
   * Add a related bookable ID
   * @param {string} bookableId Related bookable ID
   */
  addRelatedBookable(bookableId) {
    if (!this.relatedBookableIds.includes(bookableId)) {
      this.relatedBookableIds.push(bookableId);
      this.timeUpdated = Date.now();
    }
  }

  /**
   * Remove a related bookable ID
   * @param {string} bookableId Related bookable ID
   */
  removeRelatedBookable(bookableId) {
    const initialLength = this.relatedBookableIds.length;
    this.relatedBookableIds = this.relatedBookableIds.filter(
      (id) => id !== bookableId,
    );
    if (this.relatedBookableIds.length !== initialLength) {
      this.timeUpdated = Date.now();
    }
  }

  /**
   * Check if user has permission to book
   * @param {string} userId User ID
   * @param {string[]} userRoles User roles
   * @returns {boolean} True if user can book
   */
  canUserBook(userId, userRoles = []) {
    // If no restrictions, allow booking
    if (this.permittedUsers.length === 0 && this.permittedRoles.length === 0) {
      return true;
    }

    // Check user permissions
    if (this.permittedUsers.includes(userId)) {
      return true;
    }

    // Check role permissions
    return userRoles.some((role) => this.permittedRoles.includes(role));
  }

  /**
   * Get the highest applicable booking discount for a user.
   * @param {string} userId User ID
   * @param {string[]} userRoles User role IDs
   * @returns {number} Discount percent (0–100)
   */
  getUserDiscountPercent(userId, userRoles = []) {
    const discounts = this.bookingDiscounts || { users: [], roles: [] };
    let maxDiscount = 0;

    for (const entry of discounts.users || []) {
      if (entry.userId === userId) {
        maxDiscount = Math.max(maxDiscount, entry.discountPercent || 0);
      }
    }

    for (const entry of discounts.roles || []) {
      if (userRoles.includes(entry.roleId)) {
        maxDiscount = Math.max(maxDiscount, entry.discountPercent || 0);
      }
    }

    return maxDiscount;
  }

  /**
   * Calculate total price for booking duration
   * @param {number} timeBegin Start time
   * @param {number} timeEnd End time
   * @returns {number} Total price
   */
  getTotalPrice(timeBegin, timeEnd) {
    if (this.priceCategories.length === 0) {
      return 0;
    }

    const duration = (timeEnd - timeBegin) / 1000 / 60 / 60; // Hours
    const basePrice = this.getBasePriceForTime(timeBegin, timeEnd);

    switch (this.priceType) {
      case PRICE_TYPES.PER_HOUR:
        return Math.round(basePrice * duration * 100) / 100;
      case PRICE_TYPES.PER_DAY:
        return Math.round(((basePrice * duration) / 24) * 100) / 100;
      case PRICE_TYPES.PER_ITEM:
      case PRICE_TYPES.PER_SQUARE_METER:
      default:
        return Math.round(basePrice * 100) / 100;
    }
  }

  /**
   * Get base price for specific time period
   * @param {number} timeBegin Start time
   * @param {number} timeEnd End time
   * @returns {number} Base price
   */
  getBasePriceForTime(timeBegin, timeEnd) {
    // Find applicable price category based on time and conditions
    const applicableCategory = this.priceCategories.find((category) => {
      return this.isPriceCategoryApplicable(category, timeBegin, timeEnd);
    });

    return applicableCategory ? applicableCategory.priceEur : 0;
  }

  /**
   * Check if price category applies to given time
   * @param {Object} category Price category
   * @param {number} timeBegin Start time
   * @param {number} timeEnd End time
   * @returns {boolean} True if category applies
   */
  isPriceCategoryApplicable(category, timeBegin, timeEnd) {
    // Check time interval
    if (category.interval) {
      const startHour = new Date(timeBegin).getHours();
      const endHour = new Date(timeEnd).getHours();

      if (
        category.interval.start !== null &&
        startHour < category.interval.start
      ) {
        return false;
      }
      if (category.interval.end !== null && endHour > category.interval.end) {
        return false;
      }
    }

    // Check weekdays
    if (category.weekdays && category.weekdays.length > 0) {
      const weekday = new Date(timeBegin).getDay();
      if (!category.weekdays.includes(weekday)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Check if bookable is available for booking duration
   * @param {number} duration Duration in milliseconds
   * @returns {boolean} True if duration is valid
   */
  isValidBookingDuration(duration) {
    const durationMinutes = duration / 1000 / 60;

    if (this.minBookingDuration && durationMinutes < this.minBookingDuration) {
      return false;
    }

    if (this.maxBookingDuration && durationMinutes > this.maxBookingDuration) {
      return false;
    }

    return true;
  }

  /**
   * Check if bookable has specific tag
   * @param {string} tag Tag to check
   * @returns {boolean} True if bookable has tag
   */
  hasTag(tag) {
    return this.tags.includes(tag);
  }

  /**
   * Check if bookable has specific flag
   * @param {string} flag Flag to check
   * @returns {boolean} True if bookable has flag
   */
  hasFlag(flag) {
    return this.flags.includes(flag);
  }

  /**
   * Enrich this bookable with resolved custom fields
   * @param {{ instanceFields: Array, tenantFields: Array }} definitions
   * @returns {Bookable} this (for chaining)
   */
  enrichCustomFields({ instanceFields, tenantFields }) {
    const {
      CustomFieldService,
    } = require("../../services/custom-field/custom-field-service");

    const mergedDefs = CustomFieldService.mergeDefinitions({
      instanceFields,
      tenantFields,
      bookableFields: this.customFieldDefinitions || [],
    });

    this.customFields = CustomFieldService.resolveFieldsWithValues(
      mergedDefs,
      this.customFieldValues || [],
    );

    return this;
  }

  /**
   * The cover image of the bookable: the first reference of the image list —
   * determined by position, never by a field of its own. An empty list means
   * "no cover image"; a bookable the media import has not touched yet falls
   * back to its legacy `imgUrl`.
   *
   * @returns {Object|null} The reference, or null when there is none.
   */
  get coverImage() {
    return this.images?.[0] ?? this.imgUrl ?? null;
  }

  /**
   * The address the cover image is served under — the derived read field every
   * frontend and the HTML endpoint have always known as `imgUrl`.
   *
   * @returns {string} The URL, empty when there is no cover image.
   */
  get coverImageUrl() {
    return mediaReferenceUrl(this.coverImage, this.tenantId) || "";
  }

  get hasExternalPricing() {
    return (
      this.externalProviders?.some(
        (p) => p.active && p.handles.includes("pricing"),
      ) ?? false
    );
  }

  get hasExternalAvailability() {
    return (
      this.externalProviders?.some(
        (p) => p.active && p.handles.includes("availability"),
      ) ?? false
    );
  }

  get hasExternalMaxAmount() {
    return (
      this.externalProviders?.some(
        (p) => p.active && p.handles.includes("maxAmount"),
      ) ?? false
    );
  }

  get hasExternalBookingDuration() {
    return (
      this.externalProviders?.some(
        (p) => p.active && p.handles.includes("availability"),
      ) ?? false
    );
  }

  /**
   * Export public bookable information
   * @param {Object} [options]
   * @param {boolean} [options.absoluteMediaUrls] - Resolve media addresses to
   *   absolute URLs, for consumers outside the platform's own host — the
   *   HTML/JSON embed interfaces (§4.4 keeps everything else relative).
   * @returns {Object} Public bookable data
   */
  exportPublic({ absoluteMediaUrls = false } = {}) {
    const resolveUrl = (url) => (absoluteMediaUrls ? absoluteUrl(url) : url);

    return {
      id: this.id,
      tenantId: this.tenantId,
      type: this.type,
      title: this.title,
      description: this.description,
      images: enrichMediaReferences(this.images, this.tenantId).map(
        (reference) => ({ ...reference, url: resolveUrl(reference.url) }),
      ),
      // Derived from the cover image, so storefront v4 and the HTML endpoint
      // keep reading the single address they always read.
      imgUrl: resolveUrl(this.coverImageUrl) || "",
      flags: this.flags,
      tags: this.tags,
      location: this.location,
      isBookable: this.isBookable,
      amount: this.amount,
      minBookingDuration: this.minBookingDuration,
      maxBookingDuration: this.maxBookingDuration,
      bookingNotes: this.bookingNotes,
      isScheduleRelated: this.isScheduleRelated,
      isTimePeriodRelated: this.isTimePeriodRelated,
      timePeriods: this.timePeriods,
      isOpeningHoursRelated: this.isOpeningHoursRelated,
      openingHours: this.openingHours,
      preparationLeadTimeMinutes: this.preparationLeadTimeMinutes,
      serviceHours: this.serviceHours,
      bufferTimeBeforeMinutes: this.bufferTimeBeforeMinutes,
      bufferTimeAfterMinutes: this.bufferTimeAfterMinutes,
      isSpecialOpeningHoursRelated: this.isSpecialOpeningHoursRelated,
      specialOpeningHours: this.specialOpeningHours,
      isLongRange: this.isLongRange,
      longRangeOptions: this.longRangeOptions,
      isBlockPeriodRelated: this.isBlockPeriodRelated,
      blockPeriods: this.blockPeriods,
      priceValueAddedTax: this.priceValueAddedTax,
      priceCategories: this.priceCategories,
      priceType: this.priceType,
      relatedBookableIds: this.relatedBookableIds,
      checkoutBookableIds: this.checkoutBookableIds,
      eventId: this.eventId,
      attachments: (this.attachments || []).map((attachment) => {
        const enriched = enrichAttachment(attachment, this.tenantId);

        if (!enriched || !absoluteMediaUrls) {
          return enriched;
        }

        return {
          ...enriched,
          url: resolveUrl(enriched.url),
          reference: enriched.reference && {
            ...enriched.reference,
            url: resolveUrl(enriched.reference.url),
          },
        };
      }),
      customFields: this.customFields,
      customFieldValues: this.customFieldValues,
      cancellationPolicy: this.cancellationPolicy,
    };
  }

  /**
   * Export bookable summary
   * @returns {Object} Summary data
   */
  exportSummary() {
    return {
      id: this.id,
      title: this.title,
      type: this.type,
      isBookable: this.isBookable,
      isPublic: this.isPublic,
      location: this.location,
      tags: this.tags,
    };
  }

  validate() {
    SchemaUtils.validate(this, bookableSchemaDefinition);

    if (!Object.values(BOOKABLE_TYPES).includes(this.type)) {
      throw new Error(`Invalid bookable type: ${this.type}`);
    }

    if (!Object.values(PRICE_TYPES).includes(this.priceType)) {
      throw new Error(`Invalid price type: ${this.priceType}`);
    }

    if (this.minBookingDuration && this.maxBookingDuration) {
      if (this.minBookingDuration > this.maxBookingDuration) {
        throw new Error(
          "Minimum booking duration cannot be greater than maximum",
        );
      }
    }

    validateBookingModeExclusivity(this);
    validateBlockPeriods(this);

    return true;
  }

  static create(params) {
    const bookable = new Bookable(params);
    bookable.validate();
    return bookable;
  }
}

module.exports = {
  Bookable,
  BOOKABLE_TYPES,
  PRICE_TYPES,
};
