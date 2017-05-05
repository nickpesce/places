var mongoose = require('mongoose');

var pixelsSchema = new mongoose.Schema({
    x: {
        type: Number,
        required: true
    },
    y: {
        type: Number,
        required: true
    },
    color: {
        type: Number,
        required: true
    },
    username: {
        type: String,
        required: true
    }
});

var placeSchema = new mongoose.Schema({
    pixels: {
        type: [pixelsSchema],
        required: true
    },
    author: {
        type: String,
        required: true
    },
    name: {
        type: String,
        required: true
    },
    width: {
        type: Number,
        required: true
    },
    height: {
        type: Number,
        required: true
    },
    size: {
        type: Number,
        required: true
    },
    description: {
        type: String,
        required: true
    },
    address: {
        type: String,
        required: true
    },
    refresh: {
        type: Number,
        required: true
    },
    created: {
        type: Date,
        required: true
    }
});

var Place = mongoose.model('Place', placeSchema);
module.exports = Place;
