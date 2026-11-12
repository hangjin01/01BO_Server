const crypto = require('node:crypto');
// Only deliberate application errors expose their human-readable message.
function fail(status, message) { throw Object.assign(new Error(message), { status, expose: true }); }
function text(value, max, name, required = true) {
  if (value === null || value === undefined || value === '') { if (required) fail(400, `${name} is required`); return null; }
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value) > max) fail(400, `${name} is invalid or too long`);
  return value.trim();
}
function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) fail(400, 'Invalid date');
  return value;
}
function coordinate(lat, lng) {
  if (lat === '' || lng === '' || lat == null || lng == null) fail(400, 'Actual coordinates required');
  lat = Number(lat); lng = Number(lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) fail(400, 'Invalid coordinates');
  return { latitude: lat, longitude: lng };
}
function distance(a, b) {
  const rad = n => n * Math.PI / 180;
  const h = Math.sin(rad(b.latitude-a.latitude)/2)**2 + Math.cos(rad(a.latitude))*Math.cos(rad(b.latitude))*Math.sin(rad(b.longitude-a.longitude)/2)**2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.max(0,Math.min(1,h))));
}
function trip(body) {
  const start = date(body.startDate), end = date(body.endDate);
  if (start > end) fail(400, 'End date precedes start date');
  const status = body.status || 'upcoming';
  if (!['upcoming','ongoing','completed','cancelled'].includes(status)) fail(400,'Invalid trip status');
  let items;
  try { items = typeof body.itineraryJson === 'string' ? JSON.parse(body.itineraryJson) : body.itineraryJson || []; } catch { fail(400,'Invalid itinerary JSON'); }
  if (!Array.isArray(items) || items.length > 200) fail(400,'Invalid itinerary');
  const ids = new Set();
  items = items.map(item => {
    if (!item || typeof item !== 'object') fail(400,'Invalid itinerary item');
    const id = text(item.id,128,'item id');
    if (ids.has(id)) fail(400,'Duplicate itinerary ID'); ids.add(id);
    const day = date(item.date || start);
    if (day < start || day > end || !/^([01]\d|2[0-3]):[0-5]\d$/.test(item.scheduledTime)) fail(400,'Invalid itinerary date or time');
    return { id, title:text(item.title || item.locationName,255,'item title'), locationName:text(item.locationName,255,'location'), address:text(item.address,1000,'address'), date:day, scheduledTime:item.scheduledTime, coords:coordinate(item.coords?.latitude,item.coords?.longitude) };
  });
  if (![undefined,false,true,0,1].includes(body.isSharedWithTeam)) fail(400,'Invalid shared flag');
  return {title:text(body.title,255,'title'),status,startDate:start,endDate:end,destination:text(body.destination,255,'destination'),itineraryJson:JSON.stringify(items),purpose:text(body.purpose,500,'purpose',false),report:text(body.report,500000,'report',false),shared:body.isSharedWithTeam ? 1 : 0};
}
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
module.exports = { fail, text, date, coordinate, distance, trip, hash };
