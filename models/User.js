var mongoose = require('mongoose');
var passportLocalMongoose = require('passport-local-mongoose');

var userSchema = new mongoose.Schema({
    placeTimes: {
        type: [{
            address: {
                type: String,
                required: true
            },
            time: {
                type: Date,
                required: true
            }
        }],
    }
});

userSchema.plugin(passportLocalMongoose);
var User = mongoose.model('User', userSchema);
module.exports = User; 
