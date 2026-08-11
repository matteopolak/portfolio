---
title: '"I" rewrote the entirety of Minecraft in one month'
description: Some learnings from using agents to write over a million lines of Rust to create Minecraft from scratch.
date: 2026-08-11
tags:
  - rust
  - vibecoding
published: true
---

*This blog post was written entirely by me, a human.*

vibecoding is weird

models are good enough now that you can get to a decent solution quickly, exploring multiple paths in parallel. this allows fast iteration to rewrite massive portions of a codebase for minor wins

minecraft is a pretty big game. the client and server combined total just over 1.1 million lines of code (not including comments). for a single person, this would take 1800 hours of writing at 500cpm to complete. this of course wouldnt incldue writing comments, thinking about the problem (and how to design it in another language), improving performance and modularity (which often comes with a rewrite)

however, vibecoding has changed this story for the... better? worse? now, one person can complete the task reasonably well in under a month (bottlenecked on token consumption and available resources)

There have been many "rewrites" of *Minecraft: Java Edition* in the past, but they all come with some kind of caveat: only supporting some subset of mechanics, versions, and functionality. this is expected, the game has gone through too many changes, there are too many edgecases, and it gets really boring to port over tons of functionality just to call the implementation complete. that 1.1 million line figure is for a SINGLE version (of course a lot is shared), but counting all unique versions together brings it to well over 2 million lines of code.

I decided to give it a shot: rewrite the whole game, with every feature, every version, and no "well, except for X".

## The legality of cloning an entire game

Is this legal? Turns out... yes, sort of? As long as no original game assets or source code is released, and hosting a server still requires accepting the Mojang EULA, this is all technically "derivative works", which do not fall under Mojang copyright and is compltely fine (probably).

## The goal

Coming into this, my goal was to write the entire game (every single feature and bug) in Rust so I could play it in the browser via WebAssembly. But it ended up being more useful than I expected.

In fact, if you don't really care to read the rest of this blog, you should just play the game since it's right here anyways:

<game />

## Putting down the first stake

Before any code is written, a majority of the game needs to be planned out so it can be split out in parallel as soon as possible. Thankfully this is relatively easy, as I have the entire finished product at my fingertips. I started with a few research agents to read over the whole client and server to figure out all of the features, then had them categorize them into a few major parts. This allowed for a high-level overview of what WE had to make, and could be reviewed in a reasonable amount of time (~1 hour). Thankfully I've played the game for thousands of hours, so I could generally tell when something was wrong or missing.

Claude's summary of one half was a bit amusing:

> the server track alone is a multi-year effort

poor thing...

once all of the plans looked good, I had to figure out the most reasonable order, which was mostly based off of personal preference. I wanted the core client to be done first (this makes it a lot easier, as a lot of functionality can be done by the real vanilla server, and the client just has to read the packets and render the game). then, some "finishing touches" to the client (such as the f3 menu, debug options, pumpkin head overlay, and other parts that don't really affect the game in terms of packets in/out). finally, the server (which includes singleplayer, as it uses an integrated server)

I then had a few hundred GitHub issues created, tagged with priority, section, effort, and tier. The tiers are the ordering I listed above, from T1 to T4. I also created overarching tracking issues (Epics) for each tier. This had a weirdly-human vibe to it, which made it easy to keep track of what was happening, as well as to resume work easily or pick up new tasks without needing to think too much about contention right away.

## Letting it run

The next step is to "create the whole game. make no mistakes". I reviewed the core repositry once it completed (crate layout, dependencies, rust edition, etc.) and made a few changes. Then, I set up the full agent loop (or whatever it's called this week), which consists of a main Claude Code session spawning 5-10 subagents in parallel to work on separate work, then spawning more once each one finishes. This theoretically goes on until the whole game is finished, but needs some careful considerations in the real world (the one where I don't have unlimited tokens and disk space).

## Running out of space

Having 10 agents with their own target/ directory (to avoid the lockfile when running tests, etc.) quickly consumed a few hundred gibibytes and starting resulting in failed tool calls. The fix was to clear it all out, then switch to using `sccache` with a limit on the maximum cache size (as well as to support incremental compilation).

## Running out of tokens

I used a single Claude Max 20x plan for this, which gives me a budget of around 15 billion tokens (mixed, at whatever cache hit ratio, etc. I was averaging) which is not enough to run 10 agents in parallel 24/7. Thankfully this meant I usually had it running when I was around, which let me catch some weird design decisions (like using strings for block data everywhere, which happened in a few other places that I didn't catch. resulting in extremely slow chunk generation when it came to the server)

## ... Am I supposed to review all of this?

This is way too much code to thoroughly review, and I'm not exactly sure if the algorithms are right. I mean, the only way to know is to read the game's source code - that's double the reading!

Instead of reading all of it, I used a mix of playtesting (the entire game all of the way through, and trying out all of the other mechanics), differential fuzzing, and thousands of tests (written by AI, but they seem okay for the most part). Playtesting the entire game actually doesn't take very long - there really isn't much in the game at the end of the day if you spend a few hours playing through it. And since I've already played the game for thousands of hours, I can tell when some physics, mechanics, or behaviour feels "off" (of which there was a lot).

This led to the next part: for things I couldn't really tell (or didn't know because it was new), how do I know it's right? If my final goal is to use the client on public servers, I need to make sure the behaviour is identical to the real client.

This led to differential fuzzing, where I played millions of actions on the client against a real 26.2 Minecraft server, and a 26.2 Lodestone server, then compared it to a real Minecraft client against the real 26.2 Minecraft server (at a packet level). If all of the packets match, the major unchecked portion is visual differences. This can also use differential fuzzing, just taking images of the game and making sure they're the same (which is a bit harder, as the environments, timing, and screenshots need to be taking at the exact same time in perfect duplicates of the world). With tick freezing and other ways of making the environment deterministic (freezing the daylight cycle, disabling block animations and some other animations) makes it pretty accurate.

## Performance is terrible

Great. I'm running at 40fps, but I'm reaching >100fps on the regular game. This is where benchmarks, flamegraphs, SIMD, and multi-threading need to be added. Benchmarks were added for generally performance-critical work, such as chunk generation, all sorts of redstone, and entity physics. All of the performance work was guided by benchmarks and flamegraphs, since (one again) there's too much to read to look through theories of what's going wrong.

A lot of the issues are the same issues made by an amateur Rust developer: allocating tons of `String`s, cloning when `Arc` or `&` can be used (or reworking the algorithm to avoid stuff in the first place), etc.

This is another place where I had to guide (in this case, Opus 5) to use a bit more codegen. For each version, all of the entities, blocks, biomes, etc. are extracted as strings and used by the rest of the crates. Not only is this not type-safe (for example, matching over `minceraft:ghast` would be wrong), it's extremely slow. In the first implementation of world generation, the full end-to-end generation of a chunk used over 200 *million* comparisons. Switching to using indices and enums brought this number down to under 20,000.

Another big part of the performance work was simply playing the game while `samply` was running. After a couple of minutes of trying different things, the finalized flamgraph (~6GiB in size) was used by Opus and fixed a surprisingly-large number of performance bottlenecks (such as with repetitive mesh loading, occlusion culling, etc.)

## Cool, but I want to use X

Now that the game and server are complete, the next major step is integration. Integration with existing Paper/Spigot/Bukkit plugins, Fabric/Forge/etc. for the client in some way. To avoid any performance costs if a user doesn't need this, I decided to make the native plugin system rich enough to support a "compatibility" plugin externally that can do all of the work for me.

The first step was to switch everything to use `bevy-ecs`, which involved a rewrite of many thousands of lines of code (not a problem for Opus).

For servers, I created a `lodestone-nms` plugin that exposes a Java interface equivalent to the entire API surface of NMS (`net.minecraft.server`) (which is pretty big, by the way). This is what Paper, Spigot, and Bukkit use in their own APIs, so swapping out that dependency at runtime is all that's needed to support the entire ecosystem.

On the other side, `lodestone-fabric` exposes the whole Fabric API. I'm sure there are some multi-threading issues somewhere in there, and I haven't tested either one thoroughly. But it's kinda cool that it can just work like that, using an external plugin for Lodestone.

## I can do whatever I want

With everything working nicely, now I can look into more novel approaches for various parts of the game to make it more performant. For example, using incremental dependency trees to represent redstone circuits removes all of the scanning in each tick, massively improving performance for all sorts of redstone circuits by up to 100x.

Another part is TNT, which has been resolved somewhat in more recent versions of the game. Regardless, accelerating calculations for heavy TNT ticks with SIMD still increased performance (on my machine and workload) by ~4x.

## Was this worth it?

It was a cool experiment, surprisingly easier than I first expected (of course I didn't have to do that much work at the end of the day). It was also a bit of a unique situation, having a full reference for what I want to build makes it especially easy (read: lazy) to essentially translate it into another language and leverage its performance and platform compatibility.
