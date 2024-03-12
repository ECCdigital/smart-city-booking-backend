const ItemCheckoutService = require("./item-checkout-service");
const BookableManager = require("../../data-managers/bookable-manager");
const BookingManager = require("../../data-managers/booking-manager");
const CouponManager = require("../../data-managers/coupon-manager");

/**
 * Class representing a bundle checkout service.
 */
class BundleCheckoutService {

    /**
     * Create a bundle checkout service.
     * @param {string} user - The user ID.
     * @param {string} tenant - The tenant ID.
     * @param {Date} timeBegin - The start time.
     * @param {Date} timeEnd - The end time.
     * @param {Array} bookableItems - The items to be booked.
     * @param {string} couponCode - The coupon code.
     * @param {string} name - The name of the user.
     * @param {string} company - The company of the user.
     * @param {string} street - The street of the user.
     * @param {string} zipCode - The zip code of the user.
     * @param {string} location - The location of the user.
     * @param {string} email - The email of the user.
     * @param {string} phone - The phone number of the user.
     * @param {string} comment - The comment of the user.
     */
    constructor(
        user,
        tenant,
        timeBegin,
        timeEnd,
        bookableItems,
        couponCode,
        name,
        company,
        street,
        zipCode,
        location,
        email,
        phone,
        comment,
    ) {
        this.user = user;
        this.tenant = tenant;
        this.timeBegin = timeBegin;
        this.timeEnd = timeEnd;
        this.bookableItems = bookableItems;
        this.couponCode = couponCode;
        this.name = name;
        this.company = company;
        this.street = street;
        this.zipCode = zipCode;
        this.location = location;
        this.email = email;
        this.phone = phone;
        this.comment = comment;
    }

    async generateBookingReference(
        length = 8,
        chunkLength = 4,
        possible = "ABCDEFGHJKMNPQRSTUXY",
        ensureUnique = true,
        retryCount = 10,
    ) {
        if (ensureUnique && retryCount <= 0) {
            throw new Error(
                "Unable to generate booking number. Retry count exceeded.",
            );
        }

        let text = "";
        for (let i = 0; i < length; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }

        for (let i = chunkLength; i < text.length; i += chunkLength + 1) {
            text = text.slice(0, i) + "-" + text.slice(i);
        }

        if (ensureUnique) {
            if (!!(await BookingManager.getBooking(text, this.tenant)._id)) {
                return await this.generateBookingReference(
                    length,
                    chunkLength,
                    possible,
                    ensureUnique,
                    retryCount - 1,
                );
            }
        }

        return text;
    }
    async checkAll() {
        for (const bookableItem of this.bookableItems) {
            const itemCheckoutService = new ItemCheckoutService(
                this.user,
                this.tenant,
                this.timeBegin,
                this.timeEnd,
                bookableItem.bookableId,
                bookableItem.amount,
            );

            await itemCheckoutService.checkAll();
        }

        return true;
    }

    async userPriceEur() {
        let total = 0;
        for (const bookableItem of this.bookableItems) {
            const itemCheckoutService = new ItemCheckoutService(
                this.user,
                this.tenant,
                this.timeBegin,
                this.timeEnd,
                bookableItem.bookableId,
                bookableItem.amount,
                this.couponCode,
            );

            total += await itemCheckoutService.userPriceEur();
        }

        return Math.round(total * 100) / 100;

    }

    async isPaymentComplete() {
        return await this.userPriceEur() === 0;
    }

    async isAutoCommit() {
        for (const bookableItem of this.bookableItems) {
            const bookable = await BookableManager.getBookable(
                bookableItem.bookableId,
                this.tenant,
            );

            if (!bookable.autoCommitBooking) return false;
        }

        return true;
    }

    async prepareBooking() {
        await this.checkAll();

        for (const bookableItem of this.bookableItems) {
            bookableItem._bookableUsed = await BookableManager.getBookable(
                bookableItem.bookableId,
                this.tenant,
            );
            delete bookableItem._bookableUsed._id;
        }

        const booking = {
            id: await this.generateBookingReference(),
            tenant: this.tenant,
            assignedUserId: this.user?.id,
            timeBegin: this.timeBegin,
            timeEnd: this.timeEnd,
            timeCreated: Date.now(),
            bookableItems: this.bookableItems,
            couponCode: this.couponCode,
            name: this.name,
            company: this.company,
            street: this.street,
            zipCode: this.zipCode,
            location: this.location,
            mail: this.email,
            phone: this.phone,
            comment: this.comment,
            priceEur: await this.userPriceEur(),
            isCommitted: await this.isAutoCommit(),
            isPayed: await this.isPaymentComplete(),
        };

        if (this.couponCode) {
            booking._couponUsed = await CouponManager.getCoupon(
                this.couponCode,
                this.tenant,
            );
            delete booking._couponUsed._id;
        }

        return booking;
    }
}


/**
 * Class representing an automatic bundle checkout service.
 * @extends BundleCheckoutService
 */
class AutomaticBundleCheckoutService extends BundleCheckoutService {
}

/**
 * Class representing a manual bundle checkout service.
 * @extends BundleCheckoutService
 */
class ManualBundleCheckoutService extends BundleCheckoutService {

    /**
     * Create a manual bundle checkout service.
     * @param {string} user - The user ID.
     * @param {string} tenant - The tenant ID.
     * @param {Date} timeBegin - The start time.
     * @param {Date} timeEnd - The end time.
     * @param {Array} bookableItems - The items to be booked.
     * @param {string} couponCode - The coupon code.
     * @param {string} name - The name of the user.
     * @param {string} company - The company of the user.
     * @param {string} street - The street of the user.
     * @param {string} zipCode - The zip code of the user.
     * @param {string} location - The location of the user.
     * @param {string} email - The email of the user.
     * @param {string} phone - The phone number of the user.
     * @param {string} comment - The comment of the user.
     * @param {number} priceEur - The price in Euros.
     * @param {boolean} isCommit - The commit status.
     * @param {boolean} isPayed - The payment status.
     */
    constructor(user,
                tenant,
                timeBegin,
                timeEnd,
                bookableItems,
                couponCode,
                name,
                company,
                street,
                zipCode,
                location,
                email,
                phone,
                comment,
                priceEur,
                isCommit,
                isPayed) {
        super(
            user,
            tenant,
            timeBegin,
            timeEnd,
            bookableItems,
            couponCode,
            name,
            company,
            street,
            zipCode,
            location,
            email,
            phone,
            comment
        );
        this.priceEur = priceEur;
        this.isCommitted = isCommit;
        this.isPayed = isPayed;
    }

    checkAll() {
        return true;
    }

    async userPriceEur() {
        const priceEur = Number(this.priceEur);
        if (isNaN(priceEur) || priceEur < 0) {
            await super.userPriceEur();
        } else {
            return priceEur;
        }
    }

    async isAutoCommit() {
        if (this.isCommitted !== undefined && typeof this.isCommitted === "boolean") {
            return this.isCommitted;
        } else {
            return await super.isAutoCommit();
        }
    }

    async isPaymentComplete() {
        if (this.isPayed !== undefined && typeof this.isPayed === "boolean") {
            return this.isPayed;
        } else {
            return await super.isPaymentComplete();
        }
    }
}

module.exports = {
    AutomaticBundleCheckoutService,
    ManualBundleCheckoutService,
};

