const fields=['action','question','tripId','itemId','date','time','title','location','scope','recipient'];
const schema={type:'object',additionalProperties:false,properties:Object.fromEntries(fields.map(k=>[k,k==='action'?{type:'string',enum:['clarify','list_trips','create_event','update_event','write_report','send_report']}:{type:['string','null']}])),required:fields};
module.exports={fields,schema};
