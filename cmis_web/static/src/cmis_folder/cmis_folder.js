/** @odoo-module **/

import { Component, useState, useRef, onWillRender, onWillStart } from "@odoo/owl";
import { _t } from "@web/core/l10n/translation";
import { registry } from "@web/core/registry";
import { standardFieldProps } from "@web/views/fields/standard_field_props";
import {CmisBreadcrumbs} from "../cmis_breadcrumbs/cmis_breadcrumbs";
import {CmisTable} from "../cmis_table/cmis_table";
import {useService} from "@web/core/utils/hooks";
import { rpc } from "@web/core/network/rpc";


export class CmisFolderField extends Component {
    static template = "cmis_web.CmisFolderField";
    static components = {CmisBreadcrumbs, CmisTable};
    static props = {
        ...standardFieldProps,
        allowCreate: { type: Boolean, optional: true },
        backend: {
          type: Object,
          optional: true,
          shape: {
            id: { type: Number, optional: true },
            location: { type: String, optional: true },
            name: { type: String, optional: true },
            backend_error: { type: String, optional: true },
          },
        },
    };
    static defaultProps = {
        backend: null,
        allowCreate: true,
    };

    setup() {
        this.orm = useService("orm");
        onWillStart(async () => {
            this.props.backend = await this.orm.call(
                "cmis.backend",
                "get_cmis_repository_from_js",
                []);
        });
        this.state = useState({
            value: this.props.value,
            cmisObjectsWrap: [],
            isDraggingInside: false,
            parentFolders: [],
            allowableActions: {},
        });
        this.buttonCreateFolderRef = useRef("buttonCreateFolder");
        this.cmisObjectWrapperService = useService("cmisObjectWrapperService");
        this.dialogService = useService("dialog");
        this.ui = useService("ui");
        this.backend = this.props.backend || null;

        this.cmisSession = null;
        this.rootFolderId = null;
        this.displayFolderId = null;

        this.dragCount = 0;

        this.initCmisSession();

        onWillRender(async () => {
            console.log("on will render");
            this.state.value = this.props.value;
            await this.setRootFolderId();
        });
    }

    initCmisSession() {
        if (this.backend?.backend_error) {
            this.dialogService.add(WarningDialog, {
                title: "CMIS Error",
                message: this.backend.backend_error,
            });
            return;
        }
        this.cmisSession = cmis.createSession(this.backend?.location);
        this.cmisSession.setGlobalHandlers(
            this.onCmisError.bind(this),
            this.onCmisError.bind(this)
        );
        this.cmisSession.setCharacterSet(document.characterSet);
    }

    get dynamicProps() {
        const props = {
            list: this.state.cmisObjectsWrap,
            deleteObject: this.deleteObject.bind(this),
            renameObject: this.renameObject.bind(this),
            updateDocumentContent: this.updateDocumentContent.bind(this),
        };
        return props;
    }

    async setRootFolderId() {
        if (this.rootFolderId === this.state.value) {
            return;
        }
        this.rootFolderId = this.state.value;

        if (!this.rootFolderId) {
            return;
        }

        var self = this;
        const loadCmisRepositories = new Promise(function (resolve, reject) {
            if (self.cmisSession.repositories) {
                resolve();
            }
            self.cmisSession
                .loadRepositories()
                .ok(() => resolve())
                .notOk((error) => reject(error));
        });

        this.state.parentFolders = [];
        loadCmisRepositories.then(() =>
            this.displayFolder({name: "Root", id: this.rootFolderId})
        );
    }

    getCmisObjectWrapperParams() {
        return {};
    }

    async queryCmisData() {
        let self = this;
        if (!this.displayFolderId) {
            return;
        }
        const options = {
            includeAllowableActions: true,
            renditionFilter: "application/pdf",
        };
        const cmisObjectsData = await new Promise((resolve) => {
            self.cmisSession
                .getChildren(self.displayFolderId, options)
                .ok(function (data) {
                    resolve(data);
                });
        });
        const params = this.getCmisObjectWrapperParams();
        this.state.cmisObjectsWrap = this.cmisObjectWrapperService.wrap(
            cmisObjectsData.objects,
            this.cmisSession,
            params
        );
    }

    async displayFolder(folder){
        if (this.displayFolderId === folder.id) {
            return;
        }
        this.displayFolderId = folder.id;
        var self = this;
        const cmisFolderData = await new Promise((resolve) => {
            self.cmisSession
                .getObject(self.displayFolderId, "latest", {
                    includeAllowableActions: true,
                })
                .ok(function (data) {
                    resolve(data);
                });
        });
        this.state.allowableActions = cmisFolderData.allowableActions;
        this.queryCmisData();
        this.updateParentFolders(folder);
    }

    async createRootFolder() {
        if (!this.props.record.resId) {
            this.dialogService.add(WarningDialog, {
                title: "CMIS Error",
                message: this.env._t("Create your object first"),
            });
            return;
        }
        const cmisFolderValue = await rpc("/web/cmis/field/create_value", {
            model_name: this.props.record.resModel,
            res_id: this.props.record.data.id,
            field_name: this.props.name,
        });
        await this.props.record.load();
        this.props.record.model.notify();
        this.state.value = cmisFolderValue.value;
    }

    onCmisError(error) {
        this.unblockUI();
        if (error) {
            this.dialogService.add(WarningDialog, {
                title: "CMIS Error",
                message: error.body.message,
            });
        }
    }

    uploadFiles(files) {
        var self = this;
        var numFiles = files.length;
        const processedFiles = [];
        if (numFiles > 0) {
            this.blockUI();
        }
        Array.prototype.forEach.call(files, (file) => {
            // FileList is not an Array but conform to its contract
            self.cmisSession
                .createDocument(
                    self.displayFolderId,
                    file,
                    {"cmis:name": file.name},
                    file.mimetype
                )
                .ok(function (data) {
                    processedFiles.push(data);
                    if (processedFiles.length === numFiles) {
                        self.queryCmisData();
                        this.unblockUI();
                    }
                })
                .notOk(function (error) {
                    if (error) {
                        self.onCmisError(error);
                        this.unblockUI();
                    }
                });
        });
    }

    renameObject(cmisObject) {
        var self = this;
        const dialogProps = {
            title: `Rename ${cmisObject.name}`,
            name: cmisObject.name,
            confirm: (newName) => {
                if (newName !== cmisObject.name) {
                    this.cmisSession
                        .updateProperties(cmisObject.objectId, {"cmis:name": newName})
                        .ok(function () {
                            self.queryCmisData();
                        });
                }
            },
        };
        this.dialogService.add(RenameDialog, dialogProps);
    }

    updateDocumentContent(cmisObject) {
        var self = this;
        const dialogProps = {
            title: `Update content of ${cmisObject.name}`,
            confirm: (file) => {
                if (file) {
                    this.cmisSession
                        .setContentStream(cmisObject.objectId, file, true, file.name)
                        .ok(function () {
                            self.queryCmisData();
                        });
                }
            },
        };
        this.dialogService.add(UpdateDocumentContentDialog, dialogProps);
    }

    deleteObject(cmisObject) {
        var self = this;
        const dialogProps = {
            title: "Delete File",
            body: sprintf('Confirm deletion of "%s".', cmisObject.name),
            confirmLabel: "Delete",
            confirm: () => {
                this.cmisSession
                    .deleteObject(cmisObject.objectId, true)
                    .ok(function () {
                        self.queryCmisData();
                    });
            },
            cancel: () => {
                return;
            },
        };
        this.dialogService.add(ConfirmationDialog, dialogProps);
    }

    onDragenter() {
        if (!this.state.allowableActions.canCreateDocument) {
            return;
        }
        if (this.dragCount === 0) {
            this.state.isDraggingInside = true;
        }
        this.dragCount += 1;
    }

    onDragleave() {
        if (!this.state.allowableActions.canCreateDocument) {
            return;
        }
        this.dragCount -= 1;
        if (this.dragCount === 0) {
            this.state.isDraggingInside = false;
        }
    }

    onDrop(ev) {
        if (!this.state.allowableActions.canCreateDocument) {
            return;
        }
        this.state.isDraggingInside = false;
        this.uploadFiles(ev.dataTransfer.files);
    }

    onClickAddDocument() {
        const dialogProps = {
            confirm: (files) => {
                this.uploadFiles(files);
            },
        };
        this.dialogService.add(AddDocumentDialog, dialogProps);
    }

    createFolder(folderName) {
        var self = this;
        this.blockUI();
        this.cmisSession.createFolder(this.displayFolderId, folderName).ok(function () {
            self.queryCmisData();
            this.unblockUI();
        });
    }

    onClickCreateFolder() {
        const dialogProps = {
            confirm: (folderName) => {
                this.createFolder(folderName);
            },
        };
        this.dialogService.add(CreateFolderDialog, dialogProps);
    }

    updateParentFolders(folder) {
        let folderIndex = null;
        for (var i in this.state.parentFolders) {
            if (this.state.parentFolders[i].id === folder.id) {
                folderIndex = i;
                break;
            }
        }
        if (folderIndex === null) {
            this.state.parentFolders.push({id: folder.id, name: folder.name});
        } else {
            this.state.parentFolders.length = parseInt(folderIndex, 10) + 1;
        }
    }

}

export const CmisFolderFieldComponent = {
    component: CmisFolderField,
    displayName: _t("CMIS folder"),
    supportedTypes: ["cmis_folder"],
    extractProps: (fieldInfo) => ({
        backend: fieldInfo.options?.backend ?? fieldInfo.backend,
        allowCreate: fieldInfo.options?.allow_create ?? fieldInfo.allow_create,
    }),

};


CmisFolderField.template = "cmis_web.CmisFolderField";
CmisFolderField.supportedTypes = ["cmis_folder"];

CmisFolderField.extractProps = ({ field }) => {
    return {
        backend: field.backend,
        allowCreate: field.allow_create,
    };
};

registry.category("fields").add("cmis_folder", CmisFolderFieldComponent);
