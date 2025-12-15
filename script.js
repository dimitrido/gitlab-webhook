/* eslint no-console: 0, max-len:0 */

//Configuration Constants
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
        "ocppvs-frontend", "ccs-interface", "codico-ccs-ctrl"
    ]
};



const USER_MAP = new Map([
    ["dimitri. doutriaux", "dimitri. doutriaux"],
    ["sarahr", "sarah.rolland"],
    ["ahcened", "ahcene.dahmane"]
]);

const PROJECT_CHANNEL_MAP = new Map([
    ['ocppvs-frontend', "ocppvs-dev"],
    ['ocppvs-backend', "ocppvs-dev"],
    ['ccs-exi-encoder', "evis"],
    ['zmq-sockets', "evis"],
    ['evis-ccs-pm', "evis"],
    ['evis-cha-pm', "evis"],
    ['csmq-spec', "qocpp"],
    ['ocpp-controller', "qocpp"],
    ['license-checker', "evis"],
    ['qocpp-core', "qocpp"],
    ['ccs-interface', "t-evse"],
    ['codico-ccs-ctrl', "t-evse"],
    ['t-evse', "t-evse"],
    ['yaccs-secc', "yaccs"],
    ['qocpp-cs', "qocpp"]
]);


// Main Script Class
class Script {

    displayName (name) {
        return name && name.toLowerCase().replace(/\s+/g, '.');
    };

    resolveUser ({user}) {
        if (!user) return '';
        const key = this.displayName(user);
        return USER_MAP.get(key) || key;
    };

    atName (user) {
        return user && user.name ? '@' + this.resolveUser(user.name) : '';
    };

    makeAttachment (author, text, color) {
        if (color === undefined) {
            color = CONFIG.NOTIF_COLOR;
        }
        return {
            author_name: author ? this.displayName(author.name) : '',
            author_icon: author ? author.avatar_url : '',
            text:  text,
            color:  color
        };
    };

    pushUniq(array, val) {
        return ~array.indexOf(val) || array.push(val);
    };


    process_incoming_request({ request }) {
        try {
            console.log("❌ NO MESSAGE POSTED:  Event:  " + event);
            const event = request.headers['x-gitlab-event'];
            const project = request.content. project || request.content.repository;
            if (!project) {
                console.log("❌ NO MESSAGE POSTED: No project found in request");
                return false;
            }

            const stack = CONFIG.STACKS_PROJECTS.includes(project. name);
            const handlers = {
                'Resource Access Token Hook': this.accessTokenEvent,
                'Push Hook': this. pushEvent,
                'Merge Request Hook': this.mergeRequestEvent,
                'Note Hook':  this.commentEvent,
                'Confidential Issue Hook': this.issueEvent,
                'Issue Hook': this.issueEvent,
                'Tag Push Hook': this.tagEvent,
                'Pipeline Hook': this.pipelineEvent
            };

            if (stack) {
                const handler = handlers[event];
                let result;
                if (handler) {
                    result = handler. call(this, request. content);
                } else {
                    result = this.unknownEvent(request, event);
                }

                const channel = request.url.query.channel;
                if (result && result.content && channel && ! result.content.channel) {
                    result.content.channel = '#' + channel;
                }
                return result;
            } else {
                console.log("❌ NO MESSAGE POSTED:  Project '" + project.name + "' is not in STACKS_PROJECTS list");
                return this.handleError("Example error");
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
            content:  {
                text: 'Error occurred while parsing an incoming webhook request. Details attached.',
                icon_url: '',
                attachments: [
                    {
                        text: 'Error: ' + error + ', \n Message: ' + error.message + ', \n Stack: ' + error. stack,
                        // color: CONFIG.NOTIF_COLOR
                    }
                ]
            }
        };
    }
    unknownEvent(data, event) {
        console.log("❌ NO MESSAGE POSTED: Unknown event '" + event + "' occurred - no handler configured");
        return this.createErrorChatMessage("Uknown event");
    }

    issueEvent(data, event) {
        if (event === 'Confidential Issue Hook' && CONFIG.IGNORE_CONFIDENTIAL) {
            console.log("❌ NO MESSAGE POSTED: Confidential issue ignored (CONFIG.IGNORE_CONFIDENTIAL = true)");
            return false;
        }

        const project = data.project || data. repository;
        const state = data.object_attributes.state;
        let user_action = state === 'update' ? 'updated' : state;
        let assigned = '';

        if (data.assignee) {
            assigned = '*Assigned to*: @' + data.assignee.username + '\n';
        }

        const channel = PROJECT_CHANNEL_MAP. get(project.name) || 'stacks-prod';

        console.log("✅ POSTING MESSAGE: Issue event for project '" + project.name + "' to channel #" + channel);
        return {
            content: {
                username: 'gitlab/' + project.name,
                icon_url: project.avatar_url || data.user.avatar_url || '',
                channel: '#' + channel,
                text: (data.assignee && data.assignee.name !== data.user.name) ? this.atName(data.assignee) : '',
                attachments: [
                    this.makeAttachment(
                        data.user,
                        user_action + ' an issue _' + data.object_attributes.title + '_ on ' + project.name + '.\n*Description:* ' + data.object_attributes.description + '.\n' + assigned + '\nSee: ' + data.object_attributes.url
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
            console.log("❌ NO MESSAGE POSTED:  Merge request comment - notifications disabled for MR comments");
            return false;
        } else if (data.issue) {
            const issue = data.issue;
            if (issue.assignee && issue.assignee.name !== user. name) {
                this.pushUniq(at, this.atName(issue. assignee));
            }
            text = 'New comment on issue _' + issue.title + '_';
        } else if (data.snippet) {
            const snippet = data.snippet;
            text = 'New comment on snippet _' + snippet.title + '_';
        } else if (data.commit) {
            const commit = data.commit;
            const author = commit.author || {};
            text = 'New comment on commit _' + commit.title + '_';
            if (author.name !== user.name) {
                this.pushUniq(at, this.atName(author));
            }
        } else if (data.epic) {
            const epic = data.epic;
            text = 'New comment on epic _' + epic.title + '_';
            if (epic.assignee && epic.assignee.name !== user. name) {
                this.pushUniq(at, this.atName(epic. assignee));
            }
        }

        if (! text) {
            console.log("❌ NO MESSAGE POSTED:  Unrecognized comment type - cannot parse message");
            return false;
        }

        const channel = PROJECT_CHANNEL_MAP.get(project.name) || 'stacks-prod';

        console.log("✅ POSTING MESSAGE: Comment event for project '" + project.name + "' to channel #" + channel);
        return {
            content: {
                username: 'gitlab/' + project.name,
                icon_url: project.avatar_url || user.avatar_url || '',
                text: at.join(' '),
                channel: '#' + channel,
                attachments: [
                    this.makeAttachment(user, text + ' on ' + project.name + '.\n*Comment:* ' + comment.note + '.\nSee: ' + comment.url)
                ]
            }
        };
    }

    pushEvent(data) {
        const project = data.project || data. repository;
        const user = data.user_username || data.user_name || data.user || 'Someone';
        // const ref = refParser(data.ref);
        const ref = data.ref
        const commits = data.commits. slice(-5);
        const branch = ref.replace('refs/heads/', '');
        const before = data.before;
        const checkout_sha = data.checkout_sha;
        let text = '';
        const at = [];
        const channel = PROJECT_CHANNEL_MAP.get(project.name) || 'stacks-prod';

        if (checkout_sha === null) {
            text = user + ' deleted branch ' + ref + ' at ' + project.name;
        } else if (/^000000/. test(before)) {
            text = user + ' pushed new branch ' + branch + ' to ' + project.name;
        } else {
            text = user + ' pushed to branch ' + branch + ' at ' + project.name;
            if (data.total_commits_count > commits.length) {
                text += ' (' + (data.total_commits_count - commits.length) + ' commits more not shown)';
            }
        }

        const userName = typeof user === 'string' ? user : user.name;
        const attachments = commits.map(function(commit) {
            if (commit.author && commit.author.name !== userName) {
                this.pushUniq(at, this.atName(commit.author));
            }
            return {
                author_name: this.displayName(commit.author.name),
                author_icon: commit. author.avatar_url,
                title: commit.message,
                title_link: commit.url,
                text: 'Committed by:  ' + commit.author.name,
                color: CONFIG.NOTIF_COLOR
            };
        });

        console.log("✅ POSTING MESSAGE: Push event for branch '" + branch + "' on project '" + project.name + "' to channel #" + channel);
        return {
            content: {
                username: 'gitlab/' + project.name,
                icon_url: project.avatar_url || '',
                channel:  '#' + channel,
                attachments: [
                    {
                        author_name: typeof user === 'string' ? user : this.displayName(user. name),
                        author_icon: typeof user === 'string' ? '' : user.avatar_url,
                        text: text,
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
        // const ref = refParser(data.object_attributes.ref);
        const ref = data.object_attributes.ref;
        const action = data.object_attributes.status;
        const pipelineUrl = data.object_attributes.url;
        const commit = data.commit;
        const author = commit.author || {};
        const at = [];
        const stack = CONFIG.STACKS_PROJECTS.includes(project.name);
        const text = 'Pipeline ' + action + ' on ' + ref + ' at ' + project.name;

        if (commit.author) {
            const userName = typeof user === 'string' ? user :  user.name;
            if (commit.author.name !== userName) {
                this.pushUniq(at, this.atName(commit.author));
            }
        }

        const channel = PROJECT_CHANNEL_MAP.get(project.name) || 'stacks-prod';

        console.log("✅ POSTING MESSAGE: Pipeline " + action + " for project '" + project.name + "' to channel #" + channel);
        return {
            content: {
                username: 'gitlab/' + project.name,
                icon_url: project.avatar_url || '',
                channel:  '#' + channel,
                text: at.join(' '),
                attachments: [
                    this.makeAttachment(
                        commit.author || user,
                        text + '\n*Committer:* ' + commit.author.name + '.\n*Message:* ' + commit.message + '.\n' + (stack ? "Stack" : "") + ' project.\nSee: ' + pipelineUrl
                    )
                ]
            }
        };
    }

    tagEvent(data) {
        const project = data.project || data. repository;
        // const ref = refParser(data.ref);
        const ref = data.ref;

        const author = data.user_name || data.user;
        const text = author + ' pushed tag ' + ref + ' to ' + project.name;
        const channel = PROJECT_CHANNEL_MAP.get(project.name) || 'stacks-prod';

        console.log("✅ POSTING MESSAGE: Tag push '" + ref + "' for project '" + project.name + "' to channel #" + channel);
        return {
            content: {
                username: 'gitlab/' + project.name,
                icon_url: project.avatar_url || '',
                channel: '#' + channel,
                attachments: [
                    this.makeAttachment(data.user, text, CONFIG.NOTIF_COLOR)
                ]
            }
        };
    }

    mergeRequestEvent(data) {
        const project = data.project || data.repository;
        const mr = data.object_attributes;
        const user = data.user;
        const status = mr.detailed_merge_status;

        console.log("Merge Request Event - Status: " + status + ", Title: " + mr.title);

        const channel = PROJECT_CHANNEL_MAP.get(project.name) || 'stacks-prod';

        // Get priority label if available - WITHOUT optional chaining
        let priority = "Not Urgent";
        if (mr.labels) {
            const priorityLabel = mr.labels.find(function(label) {
                return label && label.title && label.title.startsWith('Priority');
            });
            if (priorityLabel && priorityLabel.title) {
                priority = priorityLabel.title;
            }
        }

        if (status === "mergeable") {
            console.log("✅ POSTING MESSAGE:  Merge request 'mergeable' status for '" + mr.title + "' on project '" + project.name + "' to channel #" + channel);
            return {
                content: {
                    username: 'gitlab/' + project.name,
                    icon_url: project.avatar_url || '',
                    channel: '#' + channel,
                    text: '@all The merge request "' + mr.title + '" is ready for review on ' + project.name,
                    attachments: [
                        {
                            author_name: user ?  this.displayName(user.name) : '',
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
                            color: CONFIG. NOTIF_COLOR
                        }
                    ]
                }
            };
        } else if (status === "request_changes") {
            const at = [];
            if (mr.assignee && mr.assignee.name !== user.name) {
                this.pushUniq(at, this.atName(mr.assignee));
            }

            console.log("✅ POSTING MESSAGE: Merge request 'request_changes' status for '" + mr.title + "' on project '" + project.name + "' to channel #" + channel);
            return {
                content:  {
                    username: 'gitlab/' + project.name,
                    icon_url: project. avatar_url || '',
                    channel: '#' + channel,
                    text: at.join(' '),
                    attachments: [
                        this.makeAttachment(
                            user,
                            'Changes requested on MR _' + mr.title + '_ on ' + project.name + '.\n*Description:* ' + (mr.description || 'No description provided') + '.\n*Priority:* ' + priority + '.\nSee: ' + mr.url
                        )
                    ]
                }
            };
        }

        console.log("❌ NO MESSAGE POSTED: Merge request status '" + status + "' for '" + mr.title + "' - only 'mergeable' and 'request_changes' statuses trigger notifications");
        return false;
    }

    accessTokenEvent(data){
        const project = data.project || data.repository;
        const channel = PROJECT_CHANNEL_MAP.get(project.name) || 'stacks-prod';
        return {
            content:  {
                username: 'gitlab/' + project.name,
                icon_url: project. avatar_url || '',
                channel: '#' + channel,
                text: '@all Access token expires soon (7 days) for project ' + data.project.name
            }
        };
    }

}
