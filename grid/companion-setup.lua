local C=function(c,a,b,d,e,f)gmss(240,125,67,71,c,a,b,d,e,f,247)end
local X=function()return gmx()+64 end
local Y=function()return gmy()+64 end
local N=function()end
CGH=function()local h=ghwcfg()C(1,X(),Y(),h//128,h%128,#ele)end
init_element_midi=function(e)e.glc=N e.glp=N
e.gms=function(s)local f,k,v=EFN,2
if f=="bc"then k,v=0,s:bva()elseif f=="ec"then k,v=1,s:eva()s:eva(64)elseif f=="epc"then k,v=1,s:epva()s:epva(64)elseif f=="pc"then v=s:pva()else return end
C(2,X(),Y(),s:ind(),k,v)end end
for i=0,#ele do if ele[i]then init_element_midi(ele[i])end end
grxm(1,7)
self.sysexrx_cb=function(s,h,x)local b={}for t in x:gmatch("%x%x")do b[#b+1]=tonumber(t,16)end
if b[4]~=71 then elseif b[5]==17 then CGH()elseif b[5]==16 and b[6]==X()and b[7]==Y()then glc(b[8],1,b[9]*2,b[10]*2,b[11]*2)glp(b[8],1,255)end end
CGH()
