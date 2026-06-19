const { BookableManager } = require("../data-managers/bookable-manager");
const {
  generateBlockPeriodInstances,
  isBlockPeriodBookable,
} = require("../utilities/block-period-generator");
const {
  AvailabilityContext,
} = require("./availability/availability-context");
const { ContextDataProvider } = require("../availability/providers");
const checkWindowAvailabilityModule = require("../availability/check-window-availability");
const {
  ManualItemCheckoutService,
} = require("./checkout/item-checkout-service");
const { NotFoundError, BadRequestError } = require("../../errors/BaseError");

class BlockPeriodService {
  /**
   * @param {string} tenantId
   * @param {string} bookableId
   * @param {string|number|Date|null|undefined} start
   * @param {string|number|Date|null|undefined} end
   * @param {number} amount
   * @param {string|{ id: string }|null|undefined} user
   * @returns {Promise<{ title: string, blockPeriods: Object[] }>}
   */
  static async getAvailableBlockPeriods(
    tenantId,
    bookableId,
    start,
    end,
    amount,
    user,
  ) {
    const bookable = await BookableManager.getBookable(bookableId, tenantId);

    if (!bookable) {
      throw new NotFoundError("bookable_not_found", { bookableId, tenantId });
    }

    if (!isBlockPeriodBookable(bookable)) {
      throw new BadRequestError("not_block_period_bookable", { bookableId });
    }

    const startDate = start ? new Date(start) : new Date();
    const endDate = end
      ? new Date(end)
      : new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000);

    startDate.setHours(0, 0, 0, 0);
    endDate.setHours(24, 0, 0, 0);

    const timeBegin = startDate.getTime();
    const timeEnd = endDate.getTime();

    const instances = generateBlockPeriodInstances(
      startDate,
      endDate,
      bookable.blockPeriods,
    );

    const context = await AvailabilityContext.create(
      tenantId,
      bookableId,
      timeBegin,
      timeEnd,
    );
    const provider = new ContextDataProvider(context);

    const blockPeriods = [];

    for (const instance of instances) {
      const availability = await checkWindowAvailabilityModule.checkWindowAvailability(
        provider,
        {
          timeBegin: instance.timeBegin,
          timeEnd: instance.timeEnd,
          amount: Number(amount),
          user,
        },
      );

      /** @type {Object} */
      const entry = {
        blockPeriodId: instance.blockPeriodId,
        label: instance.label,
        timeBegin: instance.timeBegin,
        timeEnd: instance.timeEnd,
        available: availability.available,
      };

      if (!availability.available && availability.reason) {
        entry.reason = availability.reason;
      }

      if (availability.available) {
        entry.priceEur = await BlockPeriodService.#getPriceEur(
          bookable,
          tenantId,
          user,
          instance.timeBegin,
          instance.timeEnd,
          amount,
        );
      }

      blockPeriods.push(entry);
    }

    return {
      title: bookable.title,
      blockPeriods,
    };
  }

  /**
   * @param {import("../entities/bookable/bookable").Bookable} bookable
   * @param {string} tenantId
   * @param {string|{ id: string }|null|undefined} user
   * @param {number} timeBegin
   * @param {number} timeEnd
   * @param {number} amount
   * @returns {Promise<number>}
   */
  static async #getPriceEur(
    bookable,
    tenantId,
    user,
    timeBegin,
    timeEnd,
    amount,
  ) {
    const checkout = new ManualItemCheckoutService({
      user,
      tenantId,
      timeBegin,
      timeEnd,
      bookableId: bookable.id,
      amount,
      couponCode: null,
    });

    await checkout.init(bookable);
    return checkout.regularPriceEur();
  }
}

module.exports = BlockPeriodService;
