# Activity topics: rules and API

An activity may have zero or more topics. A topic is an activity with a `parentActivityId` identifying a top-level activity in the same module and course. Topics cannot contain topics. Both kinds retain their own content, assets, publication state, completion record, discussion and identifier. Existing activities have a null parent.

## Completion rules

The activity and each published, visible topic are independent steps. Course progress counts the parent and each topic once. Draft topics and topics whose parent is a draft do not count for members. An activity without topics is complete when its own step is complete. An activity with topics is fully complete only when its own step and every visible topic are complete.

| Activity step | Visible topics | Indicator | Tooltip meaning |
| --- | --- | --- | --- |
| Incomplete | None complete | Neutral empty circle | Activity and topics not completed |
| Incomplete | Some complete | Yellow empty circle | Activity incomplete; topics remain |
| Incomplete | All complete | Yellow empty circle | All topics complete; activity incomplete |
| Complete | Some or all incomplete | Yellow checked circle | Activity complete; topics remain |
| Complete | All complete | Green checked circle | Activity and all topics complete |

Without visible topics, the indicator is a neutral empty circle or green checked circle. The tooltip should include actual completed and total topic counts where topics remain. These are presentation rules; this API does not yet expose calculated indicator states.

## Hierarchy and order

Create a topic with the existing activity creation endpoint and a `parentActivityId`. Omit it or send null to create a top-level activity. The parent must exist in the same module and be top-level. An existing activity's parent is immutable through the update endpoint. Both admin and member activity lists return `parentActivityId` and sibling-relative `seq`; the member list omits drafts and topics of draft parents.

To reorder module activities, send every top-level activity id to the existing reorder endpoint. To reorder topics, send `parentActivityId` and every topic id for that parent. The lists are separate and invalid or stale lists are rejected. Moving a top-level activity to another module moves its topics with it. A topic can move to a different top-level activity, including in another module, by supplying `targetParentActivityId` to the move endpoint; this does not convert between levels. Deleting a parent deletes its topics; clients should disclose this before requesting deletion. Existing asset and progress foreign keys follow their normal deletion rules.

Consumers of the flat activity list must not assume that sorting all rows by `seq` gives the learning order once topics exist.
