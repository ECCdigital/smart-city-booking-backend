module.exports = {
  name: "01-08-2023-convert-user-ids-to-lowercase",

  up: async function (mongoose) {
    // Convert user.id to lowercase
    const User = mongoose.model("User");
    const users = await User.find({});
    
    for (const user of users) {
      if (user.id && user.id !== user.id.toLowerCase()) {
        await User.updateOne(
          { _id: user._id },
          { $set: { id: user.id.toLowerCase() } }
        );
      }
    }
    
    // Convert booking.assignedUserId to lowercase
    const Booking = mongoose.model("Booking");
    const bookings = await Booking.find({ assignedUserId: { $exists: true, $ne: "" } });
    
    for (const booking of bookings) {
      if (booking.assignedUserId && booking.assignedUserId !== booking.assignedUserId.toLowerCase()) {
        await Booking.updateOne(
          { _id: booking._id },
          { $set: { assignedUserId: booking.assignedUserId.toLowerCase() } }
        );
      }
    }
    
    // Convert bookable.ownerUserId to lowercase
    const Bookable = mongoose.model("Bookable");
    const bookables = await Bookable.find({ ownerUserId: { $exists: true, $ne: "" } });
    
    for (const bookable of bookables) {
      if (bookable.ownerUserId && bookable.ownerUserId !== bookable.ownerUserId.toLowerCase()) {
        await Bookable.updateOne(
          { _id: bookable._id },
          { $set: { ownerUserId: bookable.ownerUserId.toLowerCase() } }
        );
      }
    }
    
    // Convert coupon.ownerUserId to lowercase
    const Coupon = mongoose.model("Coupon");
    const coupons = await Coupon.find({ ownerUserId: { $exists: true, $ne: "" } });
    
    for (const coupon of coupons) {
      if (coupon.ownerUserId && coupon.ownerUserId !== coupon.ownerUserId.toLowerCase()) {
        await Coupon.updateOne(
          { _id: coupon._id },
          { $set: { ownerUserId: coupon.ownerUserId.toLowerCase() } }
        );
      }
    }
    
    // Convert event.ownerUserId to lowercase
    const Event = mongoose.model("Event");
    const events = await Event.find({ ownerUserId: { $exists: true, $ne: "" } });
    
    for (const event of events) {
      if (event.ownerUserId && event.ownerUserId !== event.ownerUserId.toLowerCase()) {
        await Event.updateOne(
          { _id: event._id },
          { $set: { ownerUserId: event.ownerUserId.toLowerCase() } }
        );
      }
    }
    
    // Convert groupBooking.assignedUserId to lowercase
    const GroupBooking = mongoose.model("GroupBooking");
    const groupBookings = await GroupBooking.find({ assignedUserId: { $exists: true, $ne: "" } });
    
    for (const groupBooking of groupBookings) {
      if (groupBooking.assignedUserId && groupBooking.assignedUserId !== groupBooking.assignedUserId.toLowerCase()) {
        await GroupBooking.updateOne(
          { _id: groupBooking._id },
          { $set: { assignedUserId: groupBooking.assignedUserId.toLowerCase() } }
        );
      }
    }
    
    // Convert instance.ownerUserIds to lowercase
    const Instance = mongoose.model("Instance");
    const instances = await Instance.find({ ownerUserIds: { $exists: true } });
    
    for (const instance of instances) {
      if (instance.ownerUserIds && instance.ownerUserIds.length > 0) {
        const lowercaseOwnerUserIds = instance.ownerUserIds.map(id => 
          typeof id === 'string' ? id.toLowerCase() : id
        );
        
        if (JSON.stringify(lowercaseOwnerUserIds) !== JSON.stringify(instance.ownerUserIds)) {
          await Instance.updateOne(
            { _id: instance._id },
            { $set: { ownerUserIds: lowercaseOwnerUserIds } }
          );
        }
      }
    }
    
    // Convert role.assignedUserId to lowercase
    const Role = mongoose.model("Role");
    const roles = await Role.find({ assignedUserId: { $exists: true, $ne: null } });
    
    for (const role of roles) {
      if (role.assignedUserId && role.assignedUserId !== role.assignedUserId.toLowerCase()) {
        await Role.updateOne(
          { _id: role._id },
          { $set: { assignedUserId: role.assignedUserId.toLowerCase() } }
        );
      }
    }
    
    // Convert tenant.users.userId to lowercase
    const Tenant = mongoose.model("Tenant");
    const tenants = await Tenant.find({ "users.userId": { $exists: true } });
    
    for (const tenant of tenants) {
      let updated = false;
      
      if (tenant.users && tenant.users.length > 0) {
        for (let i = 0; i < tenant.users.length; i++) {
          if (tenant.users[i].userId && tenant.users[i].userId !== tenant.users[i].userId.toLowerCase()) {
            tenant.users[i].userId = tenant.users[i].userId.toLowerCase();
            updated = true;
          }
        }
        
        if (updated) {
          await Tenant.updateOne(
            { _id: tenant._id },
            { $set: { users: tenant.users } }
          );
        }
      }
      
      // Also convert tenant.ownerUserIds to lowercase
      if (tenant.ownerUserIds && tenant.ownerUserIds.length > 0) {
        const lowercaseOwnerUserIds = tenant.ownerUserIds.map(id => 
          typeof id === 'string' ? id.toLowerCase() : id
        );
        
        if (JSON.stringify(lowercaseOwnerUserIds) !== JSON.stringify(tenant.ownerUserIds)) {
          await Tenant.updateOne(
            { _id: tenant._id },
            { $set: { ownerUserIds: lowercaseOwnerUserIds } }
          );
        }
      }
    }
    },

  down: async function (mongoose) {
    console.log("This migration cannot be reverted as the original case of the IDs is not stored");
  },
};