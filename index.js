var express = require('express');
var bodyParser = require('body-parser');
var logger = require('morgan');
var dotenv = require('dotenv');
var mongoose = require('mongoose');
var exphbs = require('express-handlebars');
var _ = require('underscore');
var Place = require('./models/Place');
var User = require('./models/User');
var flash = require('connect-flash');
var cookieParser = require('cookie-parser');
var marked = require('marked');
var removeMd = require('remove-markdown');

var app = express();
var http = require('http').Server(app);
var io = require('socket.io')(http);

var passport = require('passport')
  , LocalStrategy = require('passport-local').Strategy;

dotenv.load();

mongoose.connect(process.env.MONGODB);
mongoose.connection.on('error', function() {
    console.log("Mongoose could not connect to db: " + process.env.MONGODB);
    process.exit(1);
});


passport.use(new LocalStrategy(
  function(username, password, done) {
    User.findOne({ username: username }, function(err, user) {
      if (err) { return done(err); }
      if (!user) {
        return done(null, false, { message: 'Incorrect username.' });
      }
      if (!user.validPassword(password)) {
        return done(null, false, { message: 'Incorrect password.' });
      }
      return done(null, user);
    });
  }
));
passport.serializeUser(User.serializeUser());
passport.deserializeUser(User.deserializeUser());
passport.use(new LocalStrategy(User.authenticate()));

app.use(cookieParser('secret'));
app.use(require('express-session')({
    secret: 'keyboard cat',
    resave: false,
    saveUninitialized: false
}));

app.use(passport.initialize());
app.use(passport.session());

app.use(flash());
app.use(logger('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.set('views', __dirname+'/views');
app.engine('handlebars', exphbs({ defaultLayout: 'main',layoutsDir: __dirname+"/views/layouts/",  partialsDir: __dirname+'/views/partials/'}));
app.set('view engine', 'handlebars');
app.use('/public', express.static(__dirname+'/public'));

app.get('/', function(req, res) {
    sort(req, res, {name: 1}, "PLACES", "home");
});

app.get('/new', function(req, res) {
    sort(req, res, {created: -1}, "New Places", "new");
});

app.get('/old', function(req, res) {
    sort(req, res, {created: 1}, "Old Places", "old");
});

app.get('/big', function(req, res) {
    sort(req, res, {size: -1}, "Big Places", "big");
});

app.get('/small', function(req, res) {
    sort(req, res, {size: 1}, "Small Places", "small");
});

app.get('/fast', function(req, res) {
    sort(req, res, {refresh: 1}, "Fast Places", "fast");
});

app.get('/slow', function(req, res) {
    sort(req, res, {refresh: -1}, "Slow Places", "slow");
});

function sort(req, res, sort, title, nav) {
    Place.find().sort(sort).exec(function(err, places) {
        if(err) throw err;
        let ret = _.map(places, function(place){return _.pick(place, 'name', 'address', 'description', 'refresh', 'width', 'height', 'created', 'author')});
        for(var i in ret) {
            ret[i].description = removeMd(ret[i].description);
            if(ret[i].description.length > 350) {
                ret[i].description = ret[i].description.substring(0, 346) + " ...";
            }
        }
        res.render('home', {places: ret, username: getUsername(req), title: title, nav: nav});
    });
}

app.get('/yours', function(req, res) {
    if(!loginGate(req, res, '/yours'))return;
    Place.find({author: req.user.username}, function(err, places) {
        if(err) throw err;
        let ret = _.map(places, function(place){return _.pick(place, 'name', 'address', 'description', 'refresh', 'width', 'height', 'created', 'author')});
        res.render('home', {places: ret, username: getUsername(req), title: "Your Places", nav: "yours"});
    });
});
app.get('/random', function(req, res) {
    Place.count({}, function(err, n){
        if(err)throw err;
        let r = Math.random() * n;
        Place.find({}, {}, {skip: r, limit: -1}, function(err, place) {
            if(err)throw err;
            let address = place[0].address;
            res.redirect("/place/"+address);
        });
    });
});

app.get('/create', function(req, res) {
    if(!loginGate(req, res, '/create')) return;
    res.render('create', {username: getUsername(req)});
});

app.post('/api/create', function(req, res) {
    if(!req.user) return res.redirect("/login?redirect=/create");
    var author = req.user.username;
    var width = parseInt(req.body.width);
    var height = parseInt(req.body.height);
    if(width > 100 || height > 100) return res.send(403, "The maximum size is 100x100");
    var size = width * height;
    var description = req.body.description;
    var refresh = parseInt(req.body.refresh);
    var name = req.body.name;
    var pixels = [];
    for(let x = 0; x < width; x++) {
        pixels[x] = [];
        for(let y = 0; y < height; y++) {
            pixels[x + y * width] = {x: x, y: y, color: 0, username: "N/A"};
        }
    }
    var address=createAddress(req.body.name, function(address) {
        var place = new Place({
            name: name,
            address: address,
            height: height,
            width: width,
            size: size,
            description: description,
            pixels: pixels,
            author: author,
            refresh: refresh,
            created: new Date()
        });
        place.save(function(err) {
            if(err) throw err;
            return res.redirect('/place/'+address);
        });
    });
});

function createAddress(name, callback) {
    name = name.toLowerCase();
    function helper(name, n, callback) {
        var proposed;
        if(n == 0)
            proposed = name;
        else 
            proposed = name+"_"+n;

        Place.findOne({address: proposed}, function(err, place) {
            if(err) throw err;
            if(!place) {
                    return callback(proposed);
            }
            return helper(name, n+1, callback);
        });
    }
    helper(name, 0, callback);
}

app.post('/place/:address/api/set_pixel', function(req, res) {
    if(!req.user) {
        return res.send(401, "You must be logged in to contribute!");
    }
    var address = req.params.address;
    var x = parseInt(req.body.x);
    var y = parseInt(req.body.y);
    var color = parseInt(req.body.color);

    /*
    Place.update({address: address, 
            pixels: {$eleMatch: {x: x, y: y}}}, 
        {$set: {"pixels.$.color": color}}, 
        function(err, status) {

        if(err) throw err;
        if(status.nModified == 0) return res.send("Nothing changed");
        io.emit('set', req.body);
        return res.send(status);
    });
    */
    
    Place.findOne({address: address}, function(err, place) {
        if(err) throw err;
        if(!place) return res.send(400, "Place not found");
        if(x >= place.width || x < 0 || y >= place.height || y < 0) return res.send(403, "Pixel out of bounds");
        User.findOne({username: req.user.username}, function(err, user)  {
            var entry = _.find(user.placeTimes, function(pt) {return pt.address == address});
            if(entry) {
                //Seconds until valid
                var d = place.refresh - ((new Date() - entry.time)/1000.0);
                if(d > 0) return res.send(403, "You must wait " + d + " more seconds before drawing another pixel!");
                entry.time = new Date();
            } else {
                user.placeTimes.push({address: address, time: new Date()});
            }
            user.save(function(err) {
                if(err) throw err;
            });
            place.pixels[x + y * place.width].color = color;
            place.pixels[x + y * place.width].username = user.username;

            place.save(function(err) {
                if(err) throw err;
            });
            
            io.to(address).emit('set', req.body);
            return res.send("Pixel set!");
        });
    });
});

app.get('/place/:address', function(req, res) {
    var address = req.params.address.toLowerCase();
    Place.findOne({address: address}, function(err, place) {
        if(err) throw err;
        if(!place) return res.send(400, "Place not found");
        res.render('place', {name: place.name, address: address, description: marked(place.description), author: place.author, username: getUsername(req), refreshTime: place.refresh});
    });
});

app.get('/place/:address/api/wait', function(req, res) {
    if(!req.user) return res.send("0");
    var address = req.params.address;
    Place.findOne({address: address}, function(err, place) {
        if(err) throw err;
        if(!place) return res.send(400, "Place not found");
        User.findOne({username: req.user.username}, function(err, user)  {
            if(err) throw err;
            if(!user) return res.send(400, "User not found");
            var entry = _.find(user.placeTimes, function(pt) {return pt.address == address});
            if(entry) {
                //Seconds until valid
                var d = place.refresh - ((new Date() - entry.time)/1000.0);
                return res.send(""+d);
            } else {
                return res.send("0");
            }
        });
    });
});

app.get('/place/:address/api/draw_data.json', function(req, res) {
    var address = req.params.address;
    Place.findOne({address: address}, function(err, place) {
        if(err) throw err;
        if(!place) return res.send(400, "Place not found");
        var pixels = _.map(place.pixels, function(p) {return p.color});
        var ret = {
            pixels: pixels,
            width: place.width,
            height: place.height
        }
        res.json(ret);
    });
});

app.get('/api/places', function(req, res) {
    Place.find({}, function(err, places) { if(err) throw err; return res.json(_.map(places, function(place){return _.pick(place, 'name', 'address', 'description', 'author', 'width', 'height', 'size', 'created', 'refresh')})); });
});


io.on('connection', function(socket) {
    socket.on('address', function(address) {
        socket.join(address);
    });
});

app.get('/login', function(req, res) {
    res.render('login', {messages: req.flash('error'), username: getUsername(req), redirect: req.query.redirect});
});

app.post('/api/login', usernameToLowerCase,
  passport.authenticate('local', { failureRedirect: '/login', failureFlash: true }),
    function (req, res) {        
        if(req.body.redirect)
            return res.redirect(req.body.redirect); 
        return res.redirect('/login');
    }
);

app.get('/account', function(req, res) {
    if(!loginGate(req, res, '/account'))return;
    res.render('account', {username: getUsername(req)});
});

app.post('/api/logout', function(req, res) {
    req.logout();
    res.redirect('/');
});

app.get('/signup', function(req, res) {
    res.render('signup', {username: getUsername(req), redirect: req.query.redirect});
});

app.post('/api/signup', usernameToLowerCase, function(req, res) {
    User.register(new User({ username : req.body.username.toLowerCase(), placeTimes: []}), req.body.password, function(err, account) {
        if (err) {
            return res.send(err.message);
        }
        passport.authenticate('local')(req, res, function () {
            if(req.body.redirect)
                return res.redirect(req.body.redirect);
            return res.redirect('/');
        });
    });
});

app.get('/api/user_exists', function(req, res) {
    var name=req.query.name;
    if(!name) return res.json(false);
    User.findOne({username: name.toLowerCase()}, function(err, user) {
        if(err) throw err;
        if(!user) return res.json(false);
        return res.json(true);
    });
});

function usernameToLowerCase(req, res, next){
    req.body.username = req.body.username.toLowerCase();
    next();
}

function getUsername(req) {
    if(req.user) {
        return req.user.username;
    }
    return null;
}

function loginGate(req, res, redirect) {
    if(!req.user) {
        res.redirect('/login?redirect='+redirect);
        return false;
    }
    return true;
};

http.listen(1029, function() {
    console.log('PLACES listening on port 1029!');
});
