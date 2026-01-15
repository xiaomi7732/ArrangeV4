# Notes for MS Graph APIs

## Basic calendar / events operations

* Getting all the events of a given calender by id in given period of time

    ```
    GET /me/calendars/{id}/calendarView?startDateTime={start_datetime}&endDateTime={end_datetime}
    ```

    Example:

    ```
    GET https://graph.microsoft.com/v1.0/me/calendars/AQMkADAwATZiZmYAZC05NTUAZC04ZGMzLTAwAi0wMAoARgAAAxiUx9gP5a5Ck6qCcWu4NBoHANf50sm_U-lFqc80B-Z79qYAAAIBBgAAANf50sm_U-lFqc80B-Z79qYACJeoozQAAAA=/calendarView??startdatetime=2026-01-14T19:57:27.062Z&enddatetime=2026-01-21T19:57:27.062Z
    ```

    Response

    ```json
    {
        "@odata.context": "https://graph.microsoft.com/v1.0/$metadata#users('xiaomi7732%40hotmail.com')/calendars('AQMkADAwATZiZmYAZC05NTUAZC04ZGMzLTAwAi0wMAoARgAAAxiUx9gP5a5Ck6qCcWu4NBoHANf50sm_U-lFqc80B-Z79qYAAAIBBgAAANf50sm_U-lFqc80B-Z79qYACJeoozQAAAA%3D')/calendarView",
        "value": [
            {
                "@odata.etag": "W/\"1/nSyb5T+UWpzzQH9nv2pgAIll6veQ==\"",
                "id": "AQMkADAwATZiZmYAZC05NTUAZC04ZGMzLTAwAi0wMAoARgAAAxiUx9gP5a5Ck6qCcWu4NBoHANf50sm_U-lFqc80B-Z79qYACJeolXsAAADX_dLJvlP5RanPNAf2e-amAAiXqQI5AAAA",
                "createdDateTime": "2026-01-14T18:44:47.4998815Z",
                "lastModifiedDateTime": "2026-01-14T18:44:55.5432672Z",
                "changeKey": "1/nSyb5T+UWpzzQH9nv2pgAIll6veQ==",
                "categories": [],
                "transactionId": "localevent:ade7d146-5f50-ed23-2f94-ae3afc6b3dff",
                "originalStartTimeZone": "Pacific Standard Time",
                "originalEndTimeZone": "Pacific Standard Time",
                "iCalUId": "040000008200E00074C5B7101A82E00800000000D87E8FDB8585DC0100000000000000001000000005FB1FCDC6345C4BADC9BF5F289B2521",
                "uid": "040000008200E00074C5B7101A82E00800000000D87E8FDB8585DC0100000000000000001000000005FB1FCDC6345C4BADC9BF5F289B2521",
                "reminderMinutesBeforeStart": 0,
                "isReminderOn": true,
                "hasAttachments": false,
                "subject": "First test event",
                "bodyPreview": "",
                "importance": "normal",
                "sensitivity": "normal",
                "isAllDay": false,
                "isCancelled": false,
                "isOrganizer": true,
                "responseRequested": true,
                "seriesMasterId": null,
                "showAs": "busy",
                "type": "singleInstance",
                "webLink": "https://outlook.live.com/owa/?itemid=AQMkADAwATZiZmYAZC05NTUAZC04ZGMzLTAwAi0wMAoARgAAAxiUx9gP5a5Ck6qCcWu4NBoHANf50sm%2BU%2FlFqc80B%2FZ79qYACJeolXsAAADX%2BdLJvlP5RanPNAf2e%2FamAAiXqQI5AAAA&exvsurl=1&path=/calendar/item",
                "onlineMeetingUrl": null,
                "isOnlineMeeting": false,
                "onlineMeetingProvider": "unknown",
                "allowNewTimeProposals": true,
                "occurrenceId": null,
                "isDraft": false,
                "hideAttendees": false,
                "responseStatus": {
                    "response": "organizer",
                    "time": "0001-01-01T00:00:00Z"
                },
                "body": {
                    "contentType": "html",
                    "content": ""
                },
                "start": {
                    "dateTime": "2026-01-14T19:00:00.0000000",
                    "timeZone": "UTC"
                },
                "end": {
                    "dateTime": "2026-01-15T19:30:00.0000000",
                    "timeZone": "UTC"
                },
                "location": {
                    "displayName": "",
                    "locationType": "default",
                    "uniqueIdType": "unknown",
                    "address": {},
                    "coordinates": {}
                },
                "locations": [],
                "recurrence": null,
                "attendees": [],
                "organizer": {
                    "emailAddress": {
                        "name": "Saar Shen",
                        "address": "xiaomi7732@hotmail.com"
                    }
                },
                "onlineMeeting": null
            }
        ]
    }
    ```


  * Not all the properties are useful in our case. Reduce the columns by applying `$select` filter:

    ```
    GET https://graph.microsoft.com/v1.0/me/calendars/AQMkADAwATZiZmYAZC05NTUAZC04ZGMzLTAwAi0wMAoARgAAAxiUx9gP5a5Ck6qCcWu4NBoHANf50sm_U-lFqc80B-Z79qYAAAIBBgAAANf50sm_U-lFqc80B-Z79qYACJeoozQAAAA=/calendarView?startdatetime=2026-01-14T19:57:27.062Z&enddatetime=2026-01-21T19:57:27.062Z&$select=id,createdDateTime,lastModifiedDateTime,categories,subject,body,start,end
    ```

    Respnose:
    ```json
    {
        "@odata.context": "https://graph.microsoft.com/v1.0/$metadata#users('xiaomi7732%40hotmail.com')/calendars('AQMkADAwATZiZmYAZC05NTUAZC04ZGMzLTAwAi0wMAoARgAAAxiUx9gP5a5Ck6qCcWu4NBoHANf50sm_U-lFqc80B-Z79qYAAAIBBgAAANf50sm_U-lFqc80B-Z79qYACJeoozQAAAA%3D')/calendarView(id,createdDateTime,lastModifiedDateTime,categories,subject,body,start,end)",
        "value": [
            {
                "@odata.etag": "W/\"1/nSyb5T+UWpzzQH9nv2pgAIll6veQ==\"",
                "id": "AQMkADAwATZiZmYAZC05NTUAZC04ZGMzLTAwAi0wMAoARgAAAxiUx9gP5a5Ck6qCcWu4NBoHANf50sm_U-lFqc80B-Z79qYACJeolXsAAADX_dLJvlP5RanPNAf2e-amAAiXqQI5AAAA",
                "createdDateTime": "2026-01-14T18:44:47.4998815Z",
                "lastModifiedDateTime": "2026-01-14T18:44:55.5432672Z",
                "categories": [],
                "subject": "First test event",
                "body": {
                    "contentType": "html",
                    "content": ""
                },
                "start": {
                    "dateTime": "2026-01-14T19:00:00.0000000",
                    "timeZone": "UTC"
                },
                "end": {
                    "dateTime": "2026-01-15T19:30:00.0000000",
                    "timeZone": "UTC"
                }
            }
        ]
    }
    ```

* Create an new event
  * Reference: https://learn.microsoft.com/en-us/graph/api/calendar-post-events?view=graph-rest-1.0&tabs=http
  * Basic API 
    ```
    POST /me/calendars/{id}/events
    ```

## Adding custom data by using `extensions`

* Refer to https://learn.microsoft.com/en-us/graph/extensibility-overview?tabs=http