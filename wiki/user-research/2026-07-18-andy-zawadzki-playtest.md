---
tags:
  - domain/personas
  - domain/camera
  - status/open
  - origin/external-research
---

# Playtest - Andrzej "Andy" Zawadzki - 2026-07-18

First external playtest. Feedback given over Discord (handle AndyZaw),
2026-07-18 ~22:41-23:03; Taylor's reply 2026-07-19 ~10:38-10:53. Profile:
[[andrzej-zawadzki]]. Verbatim log below, then a synthesis. Issue candidates
tracked in the session summary at the bottom (updated as they're filed).

## Andy's log (verbatim)

> **CAMERA**
> a) I would change Panning to LMB and Rotating to RMB (it's oppsite now). I just feel it's more natural, but that may be me
> b) When I click (without rotating yet) I would love to see the indicator show immediately. Now it shows only after I start rotating.
> c) I can't grasp what feels wrong, but while I like the fact I can choose any point to rotate around, the fact that my view doesn't center there creates with weird situation sometimes, where I can start rotating around a point that's obscure and then the entire rotating behaves super wild. I'm not saying centering would be a solution here.
> d) Double-click now zoomes into the place, whereas I would imagine it would move camera to have that place centered (and then maybe zoom slightly)
> e) Zoom feels much better, I like it.
> f) Both Panning and Rotating are SUPER fast, I would suggest slowing them significantly. I think with the size of the city you have it should take a little more time to "Explore it", which current speed works against.
>
> **DIRECTORY**
> a) When I click Directory, I would expect the city to have those areas highlighted and drawn (with an outline, without fill) and then I could interact with the city itself. Right now I feel like I'm interacting with the UI more, which feels a little bit odd.
> b) I would expect then to be able to go from high-level to detail, by clicking deeper into next layer: Click District (which gives me SOME infoabout it and centers it) ---> Click Building (which grants me information about ppl living there) ---> Click Apartment (which gives me info about the person living there). All of those are kinda there, just getting there is a mix of clicking through list in the explorer and clicking on actual things
> c) I was playing with the directory without realizing Inspector gives me what I wanted, which is clicking through buildings. I think right now the two means of interacting are a bit mixed. I would love to have an option, as in point (B) to interact from high-level to details, which just lets me play with the city, AND have a secondary way, which allows me to browse through the list in search for something particular (which I assume connects to the higher level gameplay loop). I think it could be used as a sandbox where I just go around and look for interesting stuff, where the city feels like a toy that's fun to play with and inspect, and a second way of looking at it which puts structure to it.
> d) I don't really understand the links that sometimes go out of the buildings to other buildings.
> e) It looks and feels like a city, but it gets lost a bit on the details level. Districts don't have much information, anything useful I could use for my research, or anything I could be using as a clue. The building information is similar, it grants avery little info I can draw some conclusions from, whereas the list of ppl whi live there is insane. Not saying that's bad, but it doens't give me a vibe of things being interesting yet, just of them being there, kind of.
>
> **CARDS**
> a) I feel like there is so much information that I don't know what's important really. It's a lot, but as I said, not sure what is what I should focus on.
> b) I like the descriptive part, but I'm wondering how many of those details would be useful. For example, atm. I can check where the character lives, but I haven't found a way to have the character physically be at another place than where they live, which means that having them selected always shows them on the screen. Also, there is no other option right now to select a character than through building or a list, which always shows me that building.
> c) Work is fun, education is fine, commuting doens't seem important, especially since I cannot interact with any of the transportation system.
> d) I think you have a lot of dry information, which is great, but what I think would add a lot of depth and interest is the thoughts of those charfacter ABOUT their life, for example: A character is a teacher. Do they like their job? do they hate it? Are they thinking about change? Relationships - are they happy with their spouse? Are they looking for a hookup? There is this list of "thoughts" at the bottom of the character panel, but sometimes they relate to the details of the character and sometimes they dont.
> I think the family part could be collapsed and only to be found when needed.
> e) I would suggest trimming down the list of details, because stuff like TShirt size feels like noise.
>
> **GENERAL**
> a) I love the concept, I think there's so much cool shit you could do with it. The thing reminds of the game Uplink (idk if you ever played it). It was a game about being a hacker. Idk why, but this game kinda rmeinds me of that.
> b) I wonder what do you want to do with it moving forward. Is it about just exploring the city and finding interesting stories? Is it about having access to "newsfeed from the city" where you get some "news" about "A man did X on a street Y" and you can start looking for it and learning about it, like an investigator. Not really for any particular reason, but maybe just to figure out if you can find them, and then learning more about them (e.g.: they attacked someone - maybe they had a rough day and they're going through a divorce)
> c) I feel like there's A LOT of info atm. and maybe there's a way to somehow streamline it - I'm not saying to remove it, but figure out what type of information is important at which level and stage of the gameplay loop.
> ~ FIN ~
> I hope that's gonna be useful :D

## Taylor's reply (verbatim, 2026-07-19)

> This is all great feedback! Thank you for your time and consideration.
>
> At a high level, there's a lot that I've been throwing at the wall to see what sticks. Though with AI, it's sometimes easier to keep throwing things at the wall and harder to take the time to edit things down; so I can use this feedback as an inflection point.
>
> I like the idea of this project becoming a city "news feed". Maybe portraying it more poetically than rigidly. I'm thinking of anime establishing shots, more than crime reporting.
>
> I have a game idea that could exist in a procedural city like this, but I think I should experiment with the game design separately, then try to weave it into the city simulation.
>
> I like the idea of rating people's engagement with their family, job, and relationships, that's something easy enough to stub in, that alludes to something more significant.
>
> I'm wanting to avoid lots of writing to start, as that would be AI propagated, and I want to really keep that minimal for now. Ideally I'd take the time to write, or better yet, find writers to help out. If you got to the Settings > Labs > Writing Lab you'll see the first draft of the string editor used for the games text. I'm wanting to use AI for building systems, but not writing content, anything that's there is AI at the moment, but the system flags that, and in time I may make it more prominent (like AI text is magenta.
>
> AI was helpful with bringing up research on Rim World, Watch Dogs: Legion, and other games (I love Tom Francis' "Heat Signature" and the head canon people would make about their characters as they'd churn through them).
>
> The key term is "Apophenia", which is the ability to see/insert life into the things they see. So, how little can I write that can point to a richer character and fuller idea of their life. I'll keep toying with this, I'm open to input. I also need to figure out where to cut it.
>
> More about specifics and 3Cs (2Cs):
> - Good call about switching LMB and RMB. Original there was more of a camera orbit system that made sense to lead with LMB, but now it's more flexible, so switching is good (and aligns with Google Earth).
> - I'll add the pin on press, good catch
> - There are some pin collisions when inspecting the city, still ironing those out, if you can find repro steps that'd help
> - Can you describe or record the speed issues? I ask because most movements should tie the movement to the mouse and world, this can get funky when looking at the map from a low angle.
> - Navigation is easier when done from a higher angle, tilted down, but you lose the "Skyline" view that the entire project is inspired by. I added a "Skyline" control mode, but it's not obvious, and you may have caught some rough edges.
>
> I'll whip up a Todo list about this and keep at it. Thanks again, your feedback has been very well considered and helpful. I hope you'll be able to see your comments in the project in the future.
>
> One framing piece I'm mulling over, making the profiles about who's awake right now, and why they're awake. That'd require a big refactor for how things like homes work, so I've been holding off until I have more of a plan.
>
> This could spread the residents out more. Since each resident's data is procedural and based on a seed, there's a chance I could have all people in the city ready to be awake at any moment, but still cull out all the sleepers to help with memory management.
>
> It's a city of eternal night, which is an interesting framing system to me. Why are people up, and are they on the verge of sleep.

## Synthesis

Three themes:

1. **Camera feel** - concrete, mostly endorsed already: LMB/RMB swap, pivot pin
   on press, double-click = center-first, speed at low angles (needs repro),
   off-center orbit wildness (needs design).
2. **Two interaction modes want separating**: a spatial toy (click the city:
   district -> building -> unit -> person, with outlines drawn IN the scene)
   and a structured browse (the directory list). Today they're mixed and the
   UI-first path dominates.
3. **Information hierarchy + apophenia**: cards carry lots of flat data and no
   interest gradient. The asks that create depth: engagement/sentiment ("do
   they like their job?"), thoughts that reference the character's actual
   details, trimming noise (t-shirt size), collapsing family. Related framing
   ideas: city news feed as poetic establishing shots; "who's awake right now"
   in the eternal-night city.

Issue candidates: see the session summary in the daily note and the issues
filed with label `playtest-andy` once agreed.

## Work spawned from this session

- [[test-plan-2026-07-19-camera-feel]] - Tier 1 camera items: LMB/RMB swap,
  pivot pin on press, double-click pan-to-focus (+ Shift+dbl / double-RMB
  zoom), context-menu suppression. Branch `feat/camera-feel`.
- [[test-plan-2026-07-19-skyline-band]] - skyline regime lowered below the
  default pose with hysteresis, pan-anywhere fix, compass 3D tilt. Same branch.
