# Intech Studio Grid

Turns a Grid controller — any mix of modules (EF44, PBF4, EN16, PO16, BU16, PB44, TEK2, VSN1, VSN2, TEK1, OCTV) — into one Companion surface over USB MIDI. Companion lays the modules out the way they are chained, and each control is a normal Companion button, so it follows pages like a Stream Deck.

## What each control does

| Grid control | In Companion |
| --- | --- |
| Button / key | Press and release |
| Encoder or endless knob | Rotate left/right; push = press |
| Fader or pot | Rotate left/right as it moves, **and** its 0-127 value as a surface variable |
| LED | Shows the button's background colour |

Rotate actions only fire if the button has **Enable rotary actions** ticked.

Fader values appear in the surface's settings as variables (one per fader/pot) which you can link to a custom variable. The **Fader/pot movement per rotate step** setting makes faders coarser (e.g. 8 = 16 steps over full travel).

## Setting up the Grid (once per module)

1. In Grid Editor, reset the module to its default configuration (the default profile).
2. Select the module's **System** element (the utility button) and open its **Setup** event.
3. Add a **Code** block and paste in the script below.
4. **Store** the configuration.
5. Repeat for every module in the chain.
6. Close Grid Editor — the Grid's MIDI port can only be used by one program at a time on Windows. Also remove any Generic MIDI connection in Companion that used the Grid.

The script makes each module announce its type and position, send its controls to Companion, and take LED colours back. It relies on each element's default actions, so leave those in place.

### The setup script

```lua
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
```

## Linking with a Stream Deck

To make the Grid follow the same page as a Stream Deck, put both in the same **surface group** in Companion's Surfaces tab.

## Notes

- Adding, removing or moving a module makes the surface reconnect with the new layout.
- Layouts for modules other than EF44 are based on Intech's element lists; the arrangement inside a module may not match the panel exactly.
- Requires Companion 5.0.
