# Reflective journals

Reload the unpacked extension and restart the backend after updating to 2.6.60.
Journal automation is integrated into Browser Assistant's **QA Control** tab.
On an Aurora assessment list, **Start journal automation** opens the one ongoing
journal and prepares it. If several are available, open the desired pencil first.
The selected subject and module appear inside QA Control when the journal opens.
Manual dropdowns are hidden when that information is detected or already known
for the current journal, and appear only when automatic detection is unavailable.
It reads Subject from Module Information and the journal
number from the page heading. Journal N uses Module N of that subject's syllabus.
If automatic detection is unavailable, choose both Subject and Module / Journal
from the panel dropdowns before clicking Start journal automation.
The five supplied syllabi are stored in `server/journal_syllabus.json`:
Backend Development Fundamentals, Computer Organization and Architecture,
Advanced Data Structures, Linear Algebra Essentials, and Fundamentals of
Artificial Intelligence (Year 2, Term 1). The AI syllabus includes all ten
modules and their lab topics from the supplied PDF.
The backend reads the syllabus file for every request. AI201 is an alias of
Fundamentals of Artificial Intelligence; future changes to the syllabus data
take effect without restarting this updated backend. Updating older backend
code still requires one restart. `/health` reports the loaded subject keys and
whether live syllabus reloading is supported.
The user's master prompt is stored unchanged in `server/journal_prompt.md` and
replaces the previous generation prompt. The full subject syllabus is supplied
for context; a portal output adapter returns only the selected module as five JSON
fields. Both backend and extension require exactly 80 words per section, 400 total.

Optionally enter your actual class experience and feelings. Click **Fill & Submit
Journal** in standalone mode, **Start journal automation** in QA Control, or press **Alt + Shift + J** while the journal page is focused, to prepare
the five sections. The shortcut also works while a journal text field is focused;
holding the keys does not start duplicate runs. On the assessment list, the same
shortcut opens the one ongoing journal's pencil link. Once content is prepared,
the extension ticks the journal's original-work declaration and clicks **Start
Assessment** automatically, as requested. Once the writing fields appear, it fills them directly,
verifies that all five values remain present with exactly 80 words each (400 total), and waits
until the portal countdown shows **30:00 remaining** before clicking the enabled
**Submit Journal** button once. A timer already below 30:00 is eligible immediately;
an unreadable or ambiguous timer keeps submission waiting. The portal timer is read,
never changed. An explicit Start can use an existing complete 400-word journal
without replacing its text or generating it again. Common confirmation dialogs are
handled. Success is reported only if the page displays a submission confirmation;
otherwise check the page for any remaining dialog. Existing text is not overwritten.
QA Control's Pause/Resume controls suspend filling while a draft is being prepared
or waiting for the form. Stop invalidates pending AI responses and prevents a later
submission; a submission already sent to the website cannot be cancelled.

The extension does not remove copy/paste restrictions or alter timers.
Only the checkbox labelled "I confirm this is my own original work" is ticked;
unrecognized or ambiguous declarations stop the run. Unknown subjects, ambiguous fields, invalid word counts,
and page changes stop submission. Screenshots establish the intended labels; the
actual Aurora form/event handling and final dialog still require a live trial.
