import { useEffect, useState } from 'react';
export function useNow(offset=0){
 const [now,setNow]=useState(()=>Date.now());
 useEffect(()=>{
  const tick=()=>setNow(Date.now());tick();
  const id=window.setInterval(tick,1000);
  window.addEventListener('focus',tick);document.addEventListener('visibilitychange',tick);
  return()=>{clearInterval(id);window.removeEventListener('focus',tick);document.removeEventListener('visibilitychange',tick);};
 },[]);
 return now+offset;
}
