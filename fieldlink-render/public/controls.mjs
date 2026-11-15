export function keyboardInput(keys){
 return {type:'input',mx:Number(keys.has('ArrowRight'))-Number(keys.has('ArrowLeft')),my:Number(keys.has('ArrowUp'))-Number(keys.has('ArrowDown')),turn:Number(keys.has('KeyD'))-Number(keys.has('KeyA')),tilt:Number(keys.has('KeyW'))-Number(keys.has('KeyS')),fire:keys.has('Space')};
}
export function headingText(player){
 const degrees=((player.yaw*180/Math.PI)%360+360)%360;
 const direction=['北','北東','東','南東','南','南西','西','北西'][Math.round(degrees/45)%8];
 const pitch=Math.round(player.pitch*180/Math.PI);
 return 'ゲーム内の'+direction+'、'+Math.round(degrees)%360+'度。'+(pitch===0?'水平です':(pitch>0?'上':'下')+Math.abs(pitch)+'度');
}
