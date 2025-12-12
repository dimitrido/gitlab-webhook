/* eslint no-console:0, max-len:0 */

// Configuration Constants
const CONFIG = {
    MENTION_ALL_ALLOWED: false,
    NOTIF_COLOR: '#6498CC',
    IGNORE_CONFIDENTIAL: true,
    GITLAB_LOGO_URL: 'https://about.gitlab.com/images/press/logo/png/gitlab-logo-500.png',
    STACKS_PROJECTS: [
        "qocpp-cs", "t-evse", "ocpp-controller", "qocpp-cs-2-0",
        "qocpp-cs-1-6", "qocpp-core-cs", "qocpp-models", "csmq-spec",
        "qocpp-core", "yaccs-secc", "evis-ccs-pm", "evis-cha-pm",
        "license-checker", "zmq-sockets", "ccs-exi-encoder", "ocppvs-backend",
        "ocppvs-frontend"
    ]
};

const USER_MAP = new Map([["dimitri.doutriaux", "dimitri.doutriaux"], ["sarahr", "sarah.rolland"], ["ahcened", "ahcene.dahmane"]]);

const PROJECT_CHANNEL_MAP = new Map([
    ['evis-ccs-pm', "evis"],
    ['csmq-spec', "qocpp"],
    ['ocpp-controller', "qocpp"],
    ['license-checker', "evis"],
    ['yaccs-secc', "yaccs"],
    ['qocpp-cs', "qocpp"]
]);

// Helper Functions
const refParser = (ref) => ref.replace(/^refs\/(?:tags|heads)\/(.+)$/, '$1');
const displayName = (name) => (name && name.toLowerCase().replace(/\s+/g, '.'));
const resolveUser = (user) => {
    console.log("User is " + user);
    if (!user) return '';
    const key = displayName(user);
    console.log("key is " + key);
    return USER_MAP.get(key) || key; // fallback to the displayName itself
};

const atName = (user) => (user && user.name ? '@' + resolveUser(user.name) : '');

const makeAttachment = (author, text, color = CONFIG.NOTIF_COLOR) => ({
    author_name: author ? displayName(author.name) : '',
    author_icon: author ? author.avatar_url : '',
    text,
    color
});

const postMessageMRReady = (data) => {
    const project_id = data.project.path_with_namespace;
    const mr_id = data.merge_request.iid;

    const priorityLabel = data.merge_request.labels?.find(label => label.title?.startsWith('Priority'));
    const urgency = priorityLabel?.title || "Not Urgent";

    let assigneeAt = "";
    if (data.merge_request.assignee) {
        assigneeAt = 'Assignee is @' + data.merge_request.assignee.username;
    }
    console.log("Assignee :" + assigneeAt);

    let mr_name = data.merge_request.title;
    let project_name = data.merge_request.target.name;

    // Determine the channel based on the project
    const channel = PROJECT_CHANNEL_MAP.get(project_name) || 'general';

    return {
        content: {
            channel: `#${channel}`,
            username: `gitlab/${data.merge_request.target.name}`,
            icon_url: CONFIG.GITLAB_LOGO_URL,
            text: '@all the merge request "' + mr_name + '" is ready for project ' + project_name + '\n' + assigneeAt,
            attachments: [
                {
                    fields: [
                        {
                            title: 'Merge Request URL',
                            value: 'http://gitlab.lan.trialog.com/' + project_id + '/-/merge_requests/' + mr_id,
                            short: false
                        },
                        {
                            title: 'Description',
                            value: data.merge_request.description,
                            short: false
                        },
                        {
                            title: 'Priority',
                            value: urgency,
                            short: false
                        }
                    ]
                }
            ]
        }
    };
};

const pushUniq = (array, val) => ~array.indexOf(val) || array.push(val);

// Main Script Class
class Script { 
    process_incoming_request({ request }) {
        try {
            const event = request.headers['x-gitlab-event'];
            console.log("Event: " + event);
            const project = request.content.project || request.content.repository;
            const stack = CONFIG.STACKS_PROJECTS.includes(project.name);
            const handlers = {
                'Push Hook': this.pushEvent,
                'Merge Request Hook': this.mergeRequestEvent,
                'Note Hook': this.commentEvent,
                'Confidential Issue Hook': this.issueEvent,
                'Issue Hook': this.issueEvent,
                'Tag Push Hook': this.tagEvent,
                'Pipeline Hook': this.pipelineEvent,
            };
            if(stack) {
                let result = handlers[event]?.call(this, request.content) || this.unknownEvent(request, event);
                const channel = request.url.query.channel;

                if (result && result.content && channel && !result.content.channel) {
                    result.content.channel = '#' + channel;
                }
                return result;
            }
            else {
                console.log("Project is not part of stacks, ignore");
            }
        } catch (e) {
            return this.handleError(e);
        }
    }

    handleError(error) {
        console.log('gitlabevent error', error);
        return this.createErrorChatMessage(error);
    }

    createErrorChatMessage(error) {
        return {
            content: {
                username: 'Rocket.Cat ErrorHandler',
                text: 'Error occurred while parsing an incoming webhook request. Details attached.',
                icon_url: '',
                attachments: [
                    {
                        text: `Error: '${error}', \n Message: '${error.message}', \n Stack: '${error.stack}'`,
                        color: CONFIG.NOTIF_COLOR
                    }
                ]
            }
        };
    }

    unknownEvent(data, event) {
        console.log(`Unknown event '${event}' occurred.`);
    }

    issueEvent(data, event) {
        if (event === 'Confidential Issue Hook' && CONFIG.IGNORE_CONFIDENTIAL) {
            return false;
        }
        const project = data.project || data.repository;
        const state = data.object_attributes.state;
        const action = data.object_attributes.action;
        let user_action = state === 'update' ? 'updated' : state;
        let assigned = '';

        if (data.assignee) {
            assigned = `*Assigned to*: @${data.assignee.username}\n`;
        }

        // Determine the channel based on the project
        const channel = PROJECT_CHANNEL_MAP.get(project.name) || 'general';

        return {
            content: {
                username: `gitlab/${project.name}`,
                icon_url: project.avatar_url || data.user.avatar_url || '',
                channel: `#${channel}`,
                text: (data.assignee && data.assignee.name !== data.user.name) ? atName(data.assignee) : '',
                attachments: [
                    makeAttachment(
                        data.user,
                        `${user_action} an issue _${data.object_attributes.title}_ on ${project.name}.
                        *Description:* ${data.object_attributes.description}.
                        ${assigned}
                        See: ${data.object_attributes.url}`
                    )
                ]
            }
        };
    }

    commentEvent(data) {
        const project = data.project || data.repository;
        const comment = data.object_attributes;
        const user = data.user;
        const at = [];
        let text;

        if (data.merge_request) {
            // Don't post notifications for comments on merge requests
            return false;
        } else if (data.issue) {
            const issue = data.issue;
            if (issue.assignee && issue.assignee.name !== user.name) {
                pushUniq(at, atName(issue.assignee));
            }
            text = `New comment on issue _${issue.title}_`;
        } else if (data.snippet) {
            const snippet = data.snippet;
            text = `New comment on snippet _${snippet.title}_`;
        } else if (data.commit) {
            const commit = data.commit;
            const author = commit.author || {};
            text = `New comment on commit _${commit.title}_`;
            if (author.name !== user.name) {
                pushUniq(at, atName(author));
            }
        } else if (data.epic) {
            const epic = data.epic;
            text = `New comment on epic _${epic.title}_`;
            if (epic.assignee && epic.assignee.name !== user.name) {
                pushUniq(at, atName(epic.assignee));
            }
        }
        if (!text) {
            console.log("Unrecognized comment type, cannot parse message");
            return {
                error: {
                    success: false,
                    message: 'Unrecognized comment type, cannot parse message.'
                }
            };
        }

        // Determine the channel based on the project
        const channel = PROJECT_CHANNEL_MAP.get(project.name) || 'general';

        return {
            content: {
                username: `gitlab/${project.name}`,
                icon_url: project.avatar_url || user.avatar_url || '',
                text: at.join(' '),
                channel: `#${channel}`,
                attachments: [
                    makeAttachment(user, `${text} on ${project.name}.\n*Comment:* ${comment.note}.\nSee: ${comment.url}`)
                ]
            }
        };
    }

    pushEvent(data) {
        const project = data.project || data.repository;
        const user = data.user_username || data.user_name || data.user || 'Someone';
        const ref = refParser(data.ref);
        const commits = data.commits.slice(-5);
        const branch = ref.replace('refs/heads/', '');
        const before = data.before;
        const checkout_sha = data.checkout_sha;
        let text = '';
        const at = [];

        // Determine the channel based on the project
        const channel = PROJECT_CHANNEL_MAP.get(project.name) || 'general';

        if (checkout_sha === null) {
            text = `${user} deleted branch ${ref} at ${project.name}`;
        } else if (/^000000/.test(before)) {
            text = `${user} pushed new branch ${branch} to ${project.name}`;
        } else {
            text = `${user} pushed to branch ${branch} at ${project.name}`;
            if (data.total_commits_count > commits.length) {
                text += ` (${data.total_commits_count - commits.length} commits more not shown)`;
            }
        }

        const userName = typeof user === 'string' ? user : user.name;
        const attachments = commits.map(commit => {
            if (commit.author && commit.author.name !== userName) {
                pushUniq(at, atName(commit.author));
            }
            return {
                author_name: displayName(commit.author.name),
                author_icon: commit.author.avatar_url,
                title: commit.message,
                title_link: commit.url,
                text: `Commited by: ${commit.author.name}`,
                color: CONFIG.NOTIF_COLOR
            };
        });

        return {
            content: {
                username: `gitlab/${project.name}`,
                icon_url: project.avatar_url || '',
                channel: `#${channel}`,
                attachments: [
                    {
                        author_name: typeof user === 'string' ? user : displayName(user.name),
                        author_icon: typeof user === 'string' ? '' : user.avatar_url,
                        text,
                        color: CONFIG.NOTIF_COLOR,
                        fields: attachments
                    }
                ]
            }
        };
    }

    pipelineEvent(data) {
        const project = data.project || data.repository;
        const user = data.user || 'GitLab';
        const ref = refParser(data.object_attributes.ref);
        const action = data.object_attributes.status;
        const pipelineUrl = `${data.object_attributes.url}`;
        const commit = data.commit;
        const author = commit.author || {};
        const at = [];
        const stack = CONFIG.STACKS_PROJECTS.includes(project.name);
        const text = `Pipeline ${action} on ${ref} at ${project.name}`;

        if (commit.author) {
            const userName = typeof user === 'string' ? user : user.name;
            if (commit.author.name !== userName) {
                pushUniq(at, atName(commit.author));
            }
        }

        // Determine the channel based on the project
        const channel = PROJECT_CHANNEL_MAP.get(project.name) || 'general';

        return {
            content: {
                username: `gitlab/${project.name}`,
                icon_url: project.avatar_url || '',
                channel: `#${channel}`,
                text: at.join(' '),
                attachments: [
                    makeAttachment(
                        commit.author || user,
                        `${text}
                        *Committer:* ${commit.author.name}.
                        *Message:* ${commit.message}.
                        ${stack ? "Stack" : ""} project.
                        See: ${pipelineUrl}`
                    )
                ]
            }
        };
    }

    tagEvent(data) {
        const project = data.project || data.repository;
        const ref = refParser(data.ref);
        const author = data.user_name || data.user;
        const text = `${author} pushed tag ${ref} to ${project.name}`;
        
        // Determine the channel based on the project
        const channel = PROJECT_CHANNEL_MAP.get(project.name) || 'general';
        
        return {
            content: {
                username: `gitlab/${project.name}`,
                icon_url: project.avatar_url || '',
                channel: `#${channel}`,
                attachments: [
                    makeAttachment(
                        data.user,
                        text,
                        CONFIG.NOTIF_COLOR
                    )
                ]
            }
        };
    }

    mergeRequestEvent(data) {
        const project = data.project || data.repository;
        const mr = data.object_attributes;
        const user = data.user;
        const state = mr.state;
        const status = mr.detailed_merge_status;

        console.log("Merge Status:", mr.detailed_merge_status);

        // Determine the channel based on the project
        const channel = PROJECT_CHANNEL_MAP.get(project.name) || 'general';

        // Get priority label if available
        const priorityLabel = mr.labels?.find(label => label?.title?.startsWith('Priority'));
        const priority = priorityLabel?.title || "Not Urgent";

        // Only post notifications for specific merge status changes
        if (status === "mergeable") {
            // MR is ready - notify everyone with @all
            return {
                content: {
                    username: `gitlab/${project.name}`,
                    icon_url: project.avatar_url || '',
                    channel: `#${channel}`,
                    text: `@all The merge request "${mr.title}" is ready for review on ${project.name}`,
                    attachments: [
                        {
                            author_name: user ? displayName(user.name) : '',
                            author_icon: user ? user.avatar_url : '',
                            fields: [
                                {
                                    title: 'Merge Request URL',
                                    value: mr.url,
                                    short: false
                                },
                                {
                                    title: 'Description',
                                    value: mr.description || 'No description provided',
                                    short: false
                                },
                                {
                                    title: 'Priority',
                                    value: priority,
                                    short: true
                                },
                                {
                                    title: 'Author',
                                    value: user ? user.name : 'Unknown',
                                    short: true
                                }
                            ],
                            color: CONFIG.NOTIF_COLOR
                        }
                    ]
                }
            };
        } else if (status === "request_changes") {
            // Changes requested - notify assignee
            const at = [];
            if (mr.assignee && mr.assignee.name !== user.name) {
                pushUniq(at, atName(mr.assignee));
            }
            
            return {
                content: {
                    username: `gitlab/${project.name}`,
                    icon_url: project.avatar_url || '',
                    channel: `#${channel}`,
                    text: at.join(' '),
                    attachments: [
                        makeAttachment(
                            user,
                            `Changes requested on MR _${mr.title}_ on ${project.name}.
*Description:* ${mr.description || 'No description provided'}.
*Priority:* ${priority}.
See: ${mr.url}`
                        )
                    ]
                }
            };
        }

        // Don't post for other merge request events
        return false;
    }
}
