const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const axios = require('axios');
const cron = require('node-cron');
const port = process.env.PORT || 3000;
const app = express();
const session = require('express-session');

// Add this before your route definitions
app.use(session({
    secret: 'your-secret-key', // Change this to a secure random string
    resave: false,
    saveUninitialized: false,
    cookie: { secure: process.env.NODE_ENV === 'production' } // Use secure cookies in production
}));

// MongoDB Connection
const uri = "mongodb+srv://reksitrajan01:8n4SHiaJfCZRrimg@cluster0.mperr.mongodb.net/climate_monitor?retryWrites=true&w=majority";
mongoose.connect(uri)
    .then(() => console.log('✅ MongoDB Connected Successfully!'))
    .catch((err) => {
        console.error('❌ MongoDB connection error:', err);
        process.exit(1);
    });

// Schema for sensor data
const sensorDataSchema = new mongoose.Schema({
    temperature: Number,
    humidity: Number,
    soilMoisture: Number,
    timestamp: { type: Date, default: Date.now }
});

// Create model
const SensorData = mongoose.model('SensorData', sensorDataSchema);

// ThingSpeak API configuration
const channelID = '2857456'; // Replace with your ThingSpeak channel ID
const readAPIKey = '3PVRMKZIGG7C7XSF';

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static('views'));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Function to fetch data from ThingSpeak and store in MongoDB
async function fetchAndStoreThingSpeakData() {
    try {
        // Fetch the latest data from ThingSpeak
        const response = await axios.get(`https://api.thingspeak.com/channels/${channelID}/feeds.json?api_key=${readAPIKey}&results=1`);
        
        if (response.data && response.data.feeds && response.data.feeds.length > 0) {
            const latestData = response.data.feeds[0];
            
            // Create a new document in MongoDB
            const newData = new SensorData({
                temperature: parseFloat(latestData.field1),
                humidity: parseFloat(latestData.field2),
                // If soil moisture is available in field3, otherwise set to null
                soilMoisture: latestData.field3 ? parseFloat(latestData.field3) : null,
                timestamp: new Date(latestData.created_at)
            });
            
            // Save to MongoDB
            await newData.save();
            console.log('✅ Data from ThingSpeak saved to MongoDB:', {
                temperature: newData.temperature,
                humidity: newData.humidity,
                soilMoisture: newData.soilMoisture,
                timestamp: newData.timestamp
            });
        }
    } catch (error) {
        console.error('❌ Error fetching or storing data from ThingSpeak:', error.message);
    }
}

// Schedule the data fetch every minute
cron.schedule('* * * * *', () => {
    console.log('🔄 Running scheduled data fetch from ThingSpeak');
    fetchAndStoreThingSpeakData();
});
// Enhanced Route to get climate history page with filtering options
app.get('/history', async (req, res) => {
    try {
        // Extract query parameters for filtering
        const dateRange = parseInt(req.query.dateRange) || 1; // Default to 1 day
        const sensorType = req.query.sensorType || 'all'; // Default to all sensors
        const sortBy = req.query.sortBy || 'newest'; // Default to newest first
        
        // Calculate the date range
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - dateRange);
        
        // Build the query object
        const query = { timestamp: { $gte: startDate } };
        
        // Add sensor type filtering if needed
        if (sensorType !== 'all') {
            query[sensorType] = { $ne: null }; // Only get records where this sensor has data
        }
        
        // Determine sort order
        const sortOrder = sortBy === 'newest' ? -1 : 1;
        
        // Get data from MongoDB with filters and limit to 30 records
        const sensorData = await SensorData.find(query)
            .sort({ timestamp: sortOrder })
            .limit(30);
        
        // Render the history page with the filtered data
        res.render('history', { 
            sensorData, 
            user: req.session ? req.session.user : null,
            filters: {
                dateRange,
                sensorType,
                sortBy
            }
        });
    } catch (error) {
        console.error('❌ Error retrieving sensor history:', error.message);
        res.status(500).send('Server Error');
    }
});


// Modify the index route
app.get('/index', async (req, res) => {
    try {
        // Get the latest sensor data
        const latestData = await SensorData.findOne().sort({ timestamp: -1 });
        
        // Get historical data for charts (last 24 hours)
        const oneDayAgo = new Date();
        oneDayAgo.setHours(oneDayAgo.getHours() - 24);
        
        const historicalData = await SensorData.find({
            timestamp: { $gte: oneDayAgo }
        }).sort({ timestamp: 1 });
        
        res.render('index', { 
            latestData: latestData || { temperature: 0, humidity: 0, soilMoisture: 0 },
            historicalData,
            user: req.session ? req.session.user : null
        });
    } catch (error) {
        console.error('❌ Error retrieving sensor data:', error.message);
        res.status(500).send('Server Error');
    }
});

// Login route - render the login page
app.get('/', (req, res) => {
    res.render('main');
});


// Login POST route
app.post('/', (req, res) => {
    const { email, password } = req.body;
    // Add your authentication logic here
    // For now, simply redirect to homepage
    res.redirect('index');
});

// Register POST route
app.post('/register', (req, res) => {
    const { name, email, password, confirmPassword } = req.body;
    // Add your registration logic here
    // For now, redirect to login with success message
    res.render('main', { success: 'Registration successful! Please login.' });
});

// API route to receive data directly from sensors
app.get('/api/sensor-data', async (req, res) => {
    try {
        // Check if receiving data from ESP32 or other IoT device
        if (req.query.temperature || req.query.humidity || req.query.soilMoisture) {
            const newData = new SensorData({
                temperature: req.query.temperature ? parseFloat(req.query.temperature) : null,
                humidity: req.query.humidity ? parseFloat(req.query.humidity) : null,
                soilMoisture: req.query.soilMoisture ? parseFloat(req.query.soilMoisture) : null
            });
            
            await newData.save();
            console.log('✅ Data received directly from IoT device saved to MongoDB');
            
            return res.json({ success: true, message: 'Data saved successfully' });
        }
        
        // Otherwise, return the data for API consumers
        const data = await SensorData.find().sort({ timestamp: -1 }).limit(100);
        res.json(data);
    } catch (error) {
        console.error('❌ Error processing API request:', error.message);
        res.status(500).json({ error: 'Server Error' });
    }
});

// Route to get climate analysis
app.get('/analysis', async (req, res) => {
    try {

        // Get date range from query parameters (default to 7 days if not specified)
        const dateRange = parseInt(req.query.dateRange) || 7;
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - dateRange);
        
        const sensorData = await SensorData.find({
            timestamp: { $gte: startDate }
        }).sort({ timestamp: 1 });
        // Get data from the last 7 days
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        
        const weekData = await SensorData.find({
            timestamp: { $gte: sevenDaysAgo }
        });
        // Format historical data for charts
        const historicalData = sensorData.map(data => ({
            timestamp: data.timestamp.toISOString(),
            temperature: data.temperature || null,
            humidity: data.humidity || null,
            soilMoisture: data.soilMoisture || null
        }));

        // Calculate averages, min, max
        let stats = {
            avgTemp: 0,
            minTemp: Infinity,
            maxTemp: -Infinity,
            avgHumidity: 0,
            minHumidity: Infinity,
            maxHumidity: -Infinity,
            avgSoilMoisture: 0,
            minSoilMoisture: Infinity,
            maxSoilMoisture: -Infinity
        };
        
        if (weekData.length > 0) {
            // Calculate statistics
            weekData.forEach(data => {
                // Temperature
                stats.avgTemp += data.temperature || 0;
                if (data.temperature && data.temperature < stats.minTemp) stats.minTemp = data.temperature;
                if (data.temperature && data.temperature > stats.maxTemp) stats.maxTemp = data.temperature;
                
                // Humidity
                stats.avgHumidity += data.humidity || 0;
                if (data.humidity && data.humidity < stats.minHumidity) stats.minHumidity = data.humidity;
                if (data.humidity && data.humidity > stats.maxHumidity) stats.maxHumidity = data.humidity;
                
                // Soil Moisture
                if (data.soilMoisture) {
                    stats.avgSoilMoisture += data.soilMoisture;
                    if (data.soilMoisture < stats.minSoilMoisture) stats.minSoilMoisture = data.soilMoisture;
                    if (data.soilMoisture > stats.maxSoilMoisture) stats.maxSoilMoisture = data.soilMoisture;
                }
            });
            
            stats.avgTemp /= weekData.length;
            stats.avgHumidity /= weekData.length;
            
            // Only average soil moisture if we have soil moisture data
            const soilMoistureData = weekData.filter(data => data.soilMoisture !== null && data.soilMoisture !== undefined);
            stats.avgSoilMoisture = soilMoistureData.length > 0 ? stats.avgSoilMoisture / soilMoistureData.length : 0;
            
            // If we had no soil moisture data, set min/max to 0
            if (stats.minSoilMoisture === Infinity) stats.minSoilMoisture = 0;
            if (stats.maxSoilMoisture === -Infinity) stats.maxSoilMoisture = 0;
        } else {
            // No data found, set all to 0
            stats.minTemp = stats.maxTemp = stats.avgTemp = 0;
            stats.minHumidity = stats.maxHumidity = stats.avgHumidity = 0;
            stats.minSoilMoisture = stats.maxSoilMoisture = stats.avgSoilMoisture = 0;
        }
        
        const correlations = {
            tempHumidity: calculateCorrelation(sensorData, 'temperature', 'humidity'),
            tempMoisture: calculateCorrelation(sensorData, 'temperature', 'soilMoisture'),
            humidityMoisture: calculateCorrelation(sensorData, 'humidity', 'soilMoisture')
        };
        
        stats.correlations = correlations;
        stats.dataPoints = sensorData.length;
        
        res.render('analysis', { 
            stats,
            historicalData,
            filters: { dateRange },
            user: req.session ? req.session.user : null 
        });
    } catch (error) {
        console.error('❌ Error generating analysis:', error.message);
        res.status(500).send('Server Error');
    }
});


// Also modify the analysis route
app.get('/analysis', async (req, res) => {
    // ... existing code ...
    
    res.render('analysis', { 
        stats,
        user: req.session ? req.session.user : null 
    });
});
// Debug route
app.get('/debug-data', async (req, res) => {
    try {
        const data = await SensorData.find().sort({ timestamp: -1 }).limit(10);
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// Helper function to calculate correlation between two data properties
function calculateCorrelation(data, property1, property2) {
    // Filter out entries where either property is missing
    const validData = data.filter(entry => 
        entry[property1] !== null && 
        entry[property1] !== undefined && 
        entry[property2] !== null && 
        entry[property2] !== undefined
    );
    
    if (validData.length < 2) {
        return 0; // Not enough data points for correlation
    }

    // Extract the values for both properties
    const values1 = validData.map(entry => entry[property1]);
    const values2 = validData.map(entry => entry[property2]);

    // Calculate means
    const mean1 = values1.reduce((sum, val) => sum + val, 0) / values1.length;
    const mean2 = values2.reduce((sum, val) => sum + val, 0) / values2.length;

    // Calculate the numerator (covariance) and denominators (standard deviations)
    let numerator = 0;
    let denominator1 = 0;
    let denominator2 = 0;

    for (let i = 0; i < values1.length; i++) {
        const diff1 = values1[i] - mean1;
        const diff2 = values2[i] - mean2;
        
        numerator += diff1 * diff2;
        denominator1 += diff1 * diff1;
        denominator2 += diff2 * diff2;
    }

    // Calculate Pearson correlation coefficient
    if (denominator1 === 0 || denominator2 === 0) {
        return 0; // Avoid division by zero
    }
    
    const correlation = numerator / (Math.sqrt(denominator1) * Math.sqrt(denominator2));
    
    // Round to 2 decimal places
    return parseFloat(correlation.toFixed(2));
}
// API route to download data in various formats
app.get('/api/download/:format', async (req, res) => {
    try {
        const format = req.params.format;
        const dateRange = parseInt(req.query.dateRange) || 30; // Default to 30 days
        
        // Calculate the date range
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - dateRange);
        
        // Get data from MongoDB
        const sensorData = await SensorData.find({
            timestamp: { $gte: startDate }
        }).sort({ timestamp: -1 });
        
        // Format as requested
        if (format === 'csv') {
            // CSV header
            let csv = 'Timestamp,Temperature,Humidity,SoilMoisture\n';
            
            // Add each data point
            sensorData.forEach(data => {
                csv += `"${data.timestamp}",${data.temperature || ''},${data.humidity || ''},${data.soilMoisture || ''}\n`;
            });
            
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename=sensor_data_${new Date().toISOString().split('T')[0]}.csv`);
            res.send(csv);
        } 
        else if (format === 'json') {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', `attachment; filename=sensor_data_${new Date().toISOString().split('T')[0]}.json`);
            res.send(json);
        }
        else if (format === 'pdf') {
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename=sensor_data_${new Date().toISOString().split('T')[0]}.pdf`);
            res.send(pdf); // Ensure 'pdf' is a Buffer or Stream
        }        
        else {
            res.status(400).json({ error: 'Unsupported format requested' });
        }
    } catch (error) {
        console.error('❌ Error generating download:', error.message);
        res.status(500).json({ error: 'Server Error' });
    }
});
// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).render('error', { 
        message: 'Something broke!', 
        error: err 
    });
});

// Logout route
app.get('/logout', (req, res) => {
    // If using express-session
    if (req.session) {
        req.session.destroy(err => {
            if (err) {
                console.error('❌ Error destroying session:', err.message);
                return res.status(500).send('Error logging out');
            }
            
            // Redirect to login page after logout
            res.redirect('/');
        });
    } else {
        res.redirect('/');
    }
});


app.post('/analysis', (req, res) => {
    res.render('analysis');
});
// Start server
app.listen(port, () => {
    console.log(`🚀 Climate Monitor Server running on port ${port}`);
    
    // Fetch sensor data immediately when the server starts
    fetchAndStoreThingSpeakData();
});