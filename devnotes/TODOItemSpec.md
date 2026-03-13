# TODO Item Spec

* subject: string
    * The title of the task
    * Maps to `subject` in an event.

* categories: inherit
    * The cateogries (like tags)
    * Maps to `categories` in an event.

* startDatetime: date
    * UTC time to the start of the task.
    * Stores in body, set upon changing of status to `inProgress`.

* etsDateTime: inherit
    * UTC time to the estimated start of the task.
    * Maps to `start` of an event.
    * May be bumped forward to today when the item is stale (see date-bump behavior below).

* createdDateTime: inherit
    * UTC to the creation of the task
    * Maps to `createdDateTime` in an event.

* lastModifiedDateTime: inherit
    * UTC to last modified.
    * Maps to `lastModifiedDateTime` in an event.

* ETADateTime: inherit
    * UTC time to the ETA of the task.
    * Maps to `end` object in an event.
    * May be bumped forward to today when the item is stale (see date-bump behavior below).

* finishDateTime: date
    * UTC time to the end of the task when the user set the status to finish
    * In body json.

* originalEtsDateTime: date | null
    * The original planned start time, preserved when etsDateTime is bumped forward.
    * In body json. Set once on first bump, never overwritten.

* originalEtaDateTime: date | null
    * The original planned end time, preserved when ETADateTime is bumped forward.
    * In body json. Set once on first bump, never overwritten.

* urgent: bool
    * The urgency of the task.
    * Urgent when true, not urgent when false.

* important: bool
    * Is an important task.
    * Important when true, not important when false.

* status: string
    * Status of the task. Possible values are: `new`, `inProgress`, `blocked`, `finished`, `cancelled`.

* checklist: string
    * An array of texts.
    * [] <- not checked.
    * [x] <- checked.

* remarks: remarkObject
    * The remark area.

* remarkObject:
    {
        "type": "text" (text | markdown)
        "content": "string"
    }

## Date-Bump Behavior

TODO items are stored as calendar events and fetched using a ±30-day time window.
To prevent non-terminal items (`new`, `inProgress`, `blocked`) from falling off the window:

* **On edit**: When a non-terminal item is updated and its calendar dates are in the past,
  `etsDateTime`/`etaDateTime` are automatically moved to today (preserving the original time-of-day
  and duration). The original values are saved to `originalEtsDateTime`/`originalEtaDateTime` on
  first bump and never overwritten.
* **On load**: A sweep runs after fetching events, bumping any remaining stale non-terminal items.

Terminal items (`finished`, `cancelled`) are never bumped.
