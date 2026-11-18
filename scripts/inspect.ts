import { PrismaClient } from "@prisma/client"; import { computeFees } from "../lib/fees";
const p = new PrismaClient();
(async()=>{
 console.log("calls w/ lead", await p.callListItem.count({where:{leadId:{not:null}}}), "w/ slot", await p.callListItem.count({where:{slotId:{not:null}}}), "w/ setter", await p.callListItem.count({where:{setterId:{not:null}}}), "booked slots", await p.freeSlot.count({where:{status:"Booked"}}), "referrals", await p.lead.count({where:{referredByCallId:{not:null}}}));
 const ls = await p.lead.findMany();
 for (const l of ls) { const f=computeFees(l as any); console.log(l.brand, l.leadName, l.company, l.stage, "setter", !!l.setterId, "GP", l.grossProfit, "CV", l.contractValue, "QV", l.quoteValue, l.quoteIssued, l.quoteIssuedDate, l.newClient, "dep", l.depositClearedDate, "=>", f.quoteFeeV2, f.winBonusTotal, f.payableThisMonth, f.setterNetEarned); }
 const st = await p.callListItem.groupBy({by:["callStatus","assignedSetter"],_count:true}); console.log(st);
})();
