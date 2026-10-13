# The Master Plan (Tentative)

The end goal of this project is, of course, assert machine dominance over humans in this web based game that only the most tryhards are grinding.

Personally, I proudly once held a position in the top 50 leaderboard on one of the maps, and top 100 on several other maps. Source is of course, trust me.
- Since my glory days, other vicious beings have snatched my seat from my hands, and being occupied with things that are other than sitting in the basement and grinding low poly racing game to compete with youtubers or streamers, I of course have not gained them back and is forever sad at the fact that I may never hold the seats again

So to enact my revenge, we have to praise the Omnissiah, summon the machines to aid us in our ~~war~~ efforts.

This has two stages. With a small amount of difference in ambition between them.

## One: Standing on the shoulder of Giants

Essentially, taking the Champion's inputs, and attempt to optimize it to gain an edge. 
- However this is more like an optimizer, than machine learning
- It is a good starting point however, if only to stroke one's ego ("Look mom I beat champion by using unfair advantage such as using a computer to brute force the search space and finding a slightly better run that shaves a couple miliseconds off of the current run")
- This is actually a prototype of a top secret part, more on that later.

## Two (Electric Boogaloo): Trying to make this Resume-Worthy

Let's think about how you (the reader! except if you are a crawler... then please carry on) would play this video game.

First, you would go in the game, and greeted with a tutorial teaching you how to use the keys w, a, s and d. Inside that tutorial (which is new. If you haven't logged on a while, go check!) it also shows you an arrow to the checkpoint where you're supposed to go. 

Now you would tentatively try gently smashing the wasd keys in an attempt to go forward, and, in a miracle as well as base instinct provided to you by our genetic ancestors, you complete the track with no issue. However our monkey brains are also competitive. So driven by a thirst for out competing other people, you restart the map. 

Congrats! You are at the beginning of the track again, but you didn't suddenly forget the entire track (If you did, highly recommend go seeing a doctor). No no no, you have remembered the general route of where you are supposed to be going. So you go at it again, this time faster. Then again, and again, until you are way faster than you could be from the beginning.

And through countless practice, with missed deadlines, lack of sleep and a sad level of social life, all of which you decided to sacrifice, you have successfully enter the elite club that is top 50 on the leaderboard. You flex this to your peers, they don't seem to care, but you know deep down they are seething with jealousy at your rank.

To prove that you are the ultimate player at this ~~silly~~ game, you have decided to try other tracks. Fortunately, soon enough (with the first couple of rounds being familiarizing yourself with the path) you got a high score, and this time with much less practice than the first time.

Now pause for a second. Why did that happen? Well the key part is that the knowledge and skill you gained from the first track -- from how the engine behaves to some techniques -- transferred over, and was useful in your endeavour in making this map faster.

> Just as an example, some of the techniques you can gain might be:
> - Micro-tapping left and right keys instead of holding them down
> - Gain an instinct of avoiding skid marks, because they are the incarnation of Satan and WILL slow you down during turns
> - Pressing the "s" key when in the air to re-orient your car

As a human those things might feel natural, but for an AI agent... they might be difficult, combining all 4 of these.
- We want it to go back and try different things
- Imagining outcome before acting on them
- Learning tricks from scratch, and retaining memory of them for...
- Generalizing to new tracks

Each one of them exist separately. We have Go-Explore, MuZero, Dreamer, etc. ...But not all together, and definitely not for discovering tricks like this in a racing game

But I have a dream okay, and if this haven't been solved by AGI by the time I reach PhD or something, this might be a thesis (just generalized to more things and not just polytrack)

What I have here is a plan for a small slice of this.

### Tricks that carry over

Micro tapping, air correction, skid mark avoidance as well as basic things like avoiding flipping over, avoiding smashing into walls, or falling off the map are car knowledge. The physics is gonna be the same on every track, so you (still the same you from earlier) can play good at every track.

But if we just train on 1 track, like what a lot of other ones did, the agent has literally no reason to learn these techniques. All its dumb ass knows is that "OOHHH I CAN PRESS LEFT HERE PLEASE GIVE ME REWARD".

That's why, being a good teacher we snatch the memorization away from them.

- Train them on multiple tracks
    - With observation relative to the car rather than the entire track, it can't really memorize all infinite of the tracks so the only way to learn, theoretically unless it finds another lazy way, is to learn the actual techniques. 
    - In our favour, PolyTrack has a functionality where we can generate infinite random tracks to train! This is a wet dream for AI Engineers...
- Fine tune them on specific tracks
    - This is literally how every model nowadays work btw, like LLM, Tesla FSD, etc...

Hopefully with this step, it will learn the tricks, and the fine tune step should be theoretically be shorter than learning a map from scratch.

### The thinking part

Now I haven't been exactly honest by saying this is my first attempt (if I ever said that at any point). There were previous work done, courtesy of borrowing the [codebase](https://github.com/michael201110/poly-bot) by michael201110, there was an attempt to RL a model into existence on the track that is Desert 1 by me.

The problem with the map is the following (you can go see yourself). Need the audience to exercise their imagination here again.

Imagine you are tackling this map. Immediately at the start of the map, there is a big ramp going up. Now normally a player would just fly off into the air, then land, and continue with their lives. But at higher and higher level of playing you will eventually realize that, "wait a minute, by being in the air I'm actually getting slower because I can't accelerate".

So you try braking at the top of the ramp, and this works you stay on the ground. But you accelerate and find out that because you lost so many speed by braking, you have to accelerate them back, and you end up around the same as being in the air anyways.

Being the smart cookie that you are, you realize that you can bump against the wall to 
- lose just enough speed to stay on the ground
- not lose so much speed that you can't catch up to the "flying in the air" version

The problem here for Reinforcement Learning is that it has trouble reconciling this trade off. See by decreasing your speed at the start, you might be slightly later to the checkpoint, but gain a massive speed advantage that pays off later. And even if the agent finds this at the start, it might just RL this away because this is a much rarer path than just flying off into the air.

When you, an (experienced) human see a ramp, you might do 3 things:
1. See the ramp coming
2. Imagine each option. Well we can scrape, fly or brake
3. Comparing the outcomes and decide in your head before committing.

A Proximal Policy Optimization agent only has a gut feeling. The value network for that is literally, "feels good man" without imagining anything. It will try random shit until its dopamine center gets hit, and it builds habits that rewards its dopamine center. These kind of random mashing don't produce precise deliberate moves, or rather, very rarely.
- Now that I thought about RL like that, it's kinda creepy.

The part we want is imagining. It will try options in the simulator before acting. Not every option though since it might be too much. Maybe we can try tree search, or cross entropy, or read more papers and ask Claude to help me with the research.

Then we train the policy to copy whatever this ~~hallucination~~ imagination found. First time it thinks hard, then after a couple repetitions, it just does it by instinct. Just like a human: first time you do it by experiment, enough times and it becomes muscle memory.

Oh, if you still have the attention span to reach here, do you still remember part 1, about optimizing based on champion? Yeah this is kinda like an expanded version of part 1.

# So what does this mean

This means that, I don't know what it means, and it's either gonna be glorious, or complete garbage.

I am fairly sure that the thinking part is going to be extremely difficult. 

Progress shall be shown in README...