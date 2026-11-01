const test=require('node:test');const assert=require('node:assert/strict');const v=require('../lib/validation');
test('date/coordinate/amount boundary and itinerary validation',()=>{
 assert.throws(()=>v.date('2026-02-30'));assert.throws(()=>v.coordinate(null,139));assert.deepEqual(v.coordinate(0,0),{latitude:0,longitude:0});assert.throws(()=>v.coordinate(100,0));assert.equal(v.distance({latitude:0,longitude:0},{latitude:0,longitude:0}),0);
 const body={title:'Test',startDate:'2026-09-25',endDate:'2026-09-26',destination:'Tokyo',itineraryJson:[{id:'one',title:'A',locationName:'A',address:'A',date:'2026-09-26',scheduledTime:'10:00',coords:{latitude:35,longitude:139}}]};
 assert.equal(JSON.parse(v.trip(body).itineraryJson)[0].date,'2026-09-26');assert.throws(()=>v.trip({...body,status:'active'}));assert.throws(()=>v.trip({...body,endDate:'2026-09-24'}));assert.throws(()=>v.trip({...body,itineraryJson:[...body.itineraryJson,...body.itineraryJson]}));assert.throws(()=>v.trip({...body,isSharedWithTeam:'false'}));
});
