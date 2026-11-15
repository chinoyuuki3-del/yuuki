// Only request() asks for location, synchronously from a user button press.
export function locationAccess({nav,secure=true,onState,onPosition,setTimer=setTimeout,clearTimer=clearTimeout}){
 let watch=null,attempt=0,timer=null,permission=null;
 let state={phase:'idle',permission:'unknown',position:null};
 const publish=patch=>{state={...state,...patch};onState({...state});};
 const clear=()=>{if(timer!==null)clearTimer(timer);timer=null;if(watch!==null)nav.geolocation.clearWatch(watch);watch=null;};
 const denied=()=>{attempt++;clear();publish({phase:'denied',permission:'denied',position:null});};
 async function inspect(){try{permission=await nav.permissions?.query({name:'geolocation'});if(!permission)return;const update=()=>{if(permission.state==='denied')denied();else publish({permission:permission.state,...(state.phase==='denied'?{phase:'idle'}:{})});};permission.onchange=update;update();}catch{/* Safari and embedded browsers may not expose Permissions API. */}}
 function request(){
  if(!secure){publish({phase:'insecure'});return;}
  if(!nav.geolocation){publish({phase:'unsupported'});return;}
  clear();const id=++attempt;publish({phase:'requesting',position:null});
  timer=setTimer(()=>{if(id===attempt&&state.phase==='requesting')publish({phase:'waiting'});},8000);
  const fail=e=>{if(id!==attempt)return;if(timer!==null)clearTimer(timer);timer=null;if(e.code===1){denied();return;}publish({phase:e.code===3?'timeout':'unavailable',position:null});};
  const accept=pos=>{if(id!==attempt)return;if(timer!==null)clearTimer(timer);timer=null;const c=pos.coords;const position={lat:c.latitude,lon:c.longitude,accuracy:c.accuracy};publish({phase:'ready',permission:'granted',position});onPosition(position);};
  // No await, permission-query, or server connection before this call.
  try{nav.geolocation.getCurrentPosition(pos=>{if(id!==attempt)return;accept(pos);watch=nav.geolocation.watchPosition(accept,fail,{enableHighAccuracy:true,maximumAge:2000,timeout:20000});},fail,{enableHighAccuracy:true,maximumAge:0,timeout:15000});}catch{fail({code:2});}
 }
 return {request,inspect,stop(){attempt++;clear();if(permission)permission.onchange=null;},get state(){return {...state};}};
}
