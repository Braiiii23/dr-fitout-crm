const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
const map={'designer':'DESIGNER','leasing agent':'LEASING_AGENT','landlord':'LANDLORD','client':'CLIENT'};
(async()=>{const items=await p.callListItem.findMany();let n=0;
for(const i of items){const t=`${i.leadInfo||''}\n${i.callNotes||''}`;const m=t.match(/CATEGORY:\s*(designer|leasing[\s_-]*agent|landlord|client)/i);
if(!m)continue;const k=map[m[1].toLowerCase().replace(/[\s_-]+/g,' ')];if(k&&k!==i.contactType){await p.callListItem.update({where:{id:i.id},data:{contactType:k}});n++;}}
console.log('updated',n);console.log(await p.callListItem.groupBy({by:['contactType'],_count:true}));await p.$disconnect();})();
