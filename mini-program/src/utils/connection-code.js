const RANGES=[{base:[10,0,0,0],size:16777216,offset:0},{base:[172,16,0,0],size:1048576,offset:16777216},{base:[192,168,0,0],size:65536,offset:17825792}];
const ipNumber=p=>(((p[0]*256+p[1])*256+p[2])*256+p[3]);
const numberIp=v=>[Math.floor(v/16777216),Math.floor(v/65536)%256,Math.floor(v/256)%256,v%256].join('.');
const normalize=code=>String(code||'').replace(/[^0-9]/g,'');
const format=code=>normalize(code).slice(0,9).replace(/(\d{3})(?=\d)/g,'$1-');
function digit(body){let sum=0;for(let i=body.length-1,d=true;i>=0;i--,d=!d){let n=Number(body[i]);if(d){n*=2;if(n>9)n-=9;}sum+=n;}return String((10-sum%10)%10);}
function encode(ip){const text=String(ip||'').trim();if(!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(text))throw new Error('无效地址');const p=text.split('.').map(Number);if(p.some(n=>n<0||n>255))throw new Error('无效地址');const v=ipNumber(p);const r=RANGES.find(x=>v>=ipNumber(x.base)&&v<ipNumber(x.base)+x.size);if(!r)throw new Error('非私有地址');const body=String(r.offset+v-ipNumber(r.base)).padStart(8,'0');return format(body+digit(body));}
function decode(code){const n=normalize(code);if(n.length!==9||n[8]!==digit(n.slice(0,8)))throw new Error('连接码有误，请检查后重新输入');const index=Number(n.slice(0,8));const r=[...RANGES].reverse().find(x=>index>=x.offset);if(!r||index-r.offset>=r.size)throw new Error('连接码有误，请检查后重新输入');return numberIp(ipNumber(r.base)+index-r.offset);}
function isValid(code){try{decode(code);return true;}catch(_error){return false;}}
module.exports={encode,decode,format,normalize,isValid};
