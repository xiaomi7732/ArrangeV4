# TODO Item Spec

* subject: string
    * The title of the task
    * Maps to `subject` in an event.

* startDatetime: date
    * UTC time to the start of the task.
    * Stores in body, set upon changing of status to `inProgress`.

* etsDateTime: inherit
    * UTC time to the estimated start of the task.
    * Maps to `start` of an event.

* createdDateTime: inherit
    * UTC to the creation of the task
    * Maps to `createdDateTime` in an event.

* lastModifiedDateTime: inherit
    * UTC to last modified.
    * Maps to `lastModifiedDateTime` in an event.

* ETADateTime: inherit
    * UTC time to the ETA of the task.
    * Maps to `end` object in an event.

* finishDateTime: date
    * UTC time to the end of the task when the user set the status to finish
    * In body json.

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
