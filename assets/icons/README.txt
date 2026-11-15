Your own images for the compendiums
===================================

Every weapon, item, skill, class, Combat Art and Battalion in the compendiums is given an icon from the library that ships with
Foundry. To use an image of your own instead, put it in the folder for its compendium and build that
compendium again:

    assets/icons/weapons/     node tools/build-weapons.mjs
    assets/icons/items/       node tools/build-items.mjs
    assets/icons/skills/      node tools/build-skills.mjs
    assets/icons/classes/     node tools/build-classes.mjs
    assets/icons/arts/        node tools/build-arts.mjs
    assets/icons/battalions/  node tools/build-battalions.mjs

Close the world (return to setup) before building, and launch it again afterwards.

Naming
------

Name the file after the entry. Capitals, spaces, accents and punctuation do not matter, so all of these are
picked up for the Iron Axe:

    iron-axe.webp      Iron Axe.png      iron_axe.jpg

Accepted types: .webp .png .jpg .jpeg .svg .gif .avif

Each folder has a names.txt, rewritten by every build, that lists the file name for every entry, the folder
the entry is in and the image it uses now. Search it for the entry you want.

Entries that share a name
-------------------------

One image covers every entry of that name: claw.webp is used by all five Claws, and freeze.webp by both the
Freeze tome and the Freeze staff. To give just one of them its own image, use the more specific name in the
second column of names.txt, for example ice-freeze.webp and staff-freeze.webp.

What the build tells you
------------------------

The "Images" part of each build's report counts how many entries used your own images, and lists any image
in these folders that matched no entry, which usually means a misspelt file name.

Images you add here are yours to source. Nothing in these folders is needed for the system to work.
