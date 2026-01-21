/** @odoo-module **/

import { _t } from "@web/core/l10n/translation";
import { registry } from "@web/core/registry";
import { standardFieldProps } from "@web/views/fields/standard_field_props";
import {CmisBreadcrumbs} from "../cmis_breadcrumbs/cmis_breadcrumbs";
import {CmisTable} from "../cmis_table/cmis_table";
import {useService} from "@web/core/utils/hooks";
import { rpc } from "@web/core/network/rpc";
import { WarningDialog } from "@web/core/errors/error_dialogs";
import {UpdateDocumentContentDialog} from "../update_document_content_dialog/update_document_content_dialog";
import {RenameDialog} from "../rename_dialog/rename_dialog";
import {sprintf} from "@web/core/utils/strings";
import {ConfirmationDialog} from "@web/core/confirmation_dialog/confirmation_dialog";
import { CmisLoginDialog } from "@cmis_web/cmis_login_dialog/cmis_login_dialog";
const {Component, onWillRender, useRef, useState, onWillStart} = owl;

export class CmisFolderField extends Component {
    static template = "cmis_web.CmisFolderField";
    static components = {CmisBreadcrumbs, CmisTable};
    static props = {
        ...standardFieldProps,
        allowCreate: {type: Boolean, optional: true},
        backend_cmis: {
            type: Object,
            optional: true,
            shape: {
                id: {type: Number, optional: true},
                location: {type: String, optional: true},
                name: {type: String, optional: true},
                share_location: {type: String, optional: true},
                alfresco_api_location: {type: String, optional: true},
                backend_error: {type: String, optional: true},
            },
        },
    };
    static defaultProps = {
        backend_cmis: null,
        allowCreate: true,
    };

    setup() {
        // Instance all fields/service/ref
        this.buttonCreateFolderRef = useRef("buttonCreateFolder");
        this.cmisObjectWrapperService = useService("cmisObjectWrapperService");
        this.dialogService = useService("dialog");
        this.ui = useService("ui");
        this.cmisSession = null;
        this.rootFolderId = null;
        this.displayFolderId = null;
        this.alfUser = null;
        this.state = useState({
            value: this.props.value,
            cmisObjectsWrap: [],
            isDraggingInside: false,
            parentFolders: [],
            allowableActions: {},
        });
        this.dragCount = 0;
        this.orm = useService("orm");

        // Get informations from cmis.backend + Create first session
        onWillStart(async () => {
            this.loadSessionInfo();
            // await this.ensureAlfrescoAuth();
            this.props.backend_cmis = await this.orm.call(
                "cmis.backend",
                "get_cmis_repository_from_js",
                []);
            this.backend_cmis = this.props.backend_cmis;
            await this.initCmisSession();
        });

        // Set First repository and fill value
        onWillRender(async () => {
            this.state.value = this.props.record.data;
            await this.setRootFolderId();
        });
    }

    async loadSessionInfo() {
      const res = await rpc("/cmis/session_info", {});
      this.alfUser = res?.alf_user || null;
    }

    async ensureAlfrescoAuth() {
        if (!this.dialogService) return;

      await new Promise((resolve) => {
        const close = this.dialogService.add(CmisLoginDialog, {
          onSuccess: async () => {
            close();
            await this.reloadAfterLogin();
            resolve();
          },
        }, {
          title: "Connexion Alfresco",
        });
      });
    }

    async reloadAfterLogin() {
        await this.setRootFolderId();
        await this.loadSessionInfo();
        if (this.displayFolderId) {
            await this.displayFolder({ name: "Current", id: this.displayFolderId });
        } else if (this.rootFolderId) {
            await this.displayFolder({ name: "Root", id: this.rootFolderId });
        } else if (this.props?.id) {
            await this.displayFolder({ name: "Root", id: this.props.id });
        }
    }

    async logoutAlfresco() {
        await rpc("/cmis/logout", {});
        this.state.cmisObjectsWrap = [];
        this.state.parentFolders = [];
        this.displayFolderId = null;
        this.alfUser = null;
        await this.setRootFolderId();
    }

    initCmisSession() {
        if (this.backend_cmis?.backend_error) {
            this.dialogService.add(WarningDialog, {
                title: "CMIS Error",
                message: this.backend_cmis.backend_error,
            });
            return;
        }

        const proxyUrl = "/cmis/proxy/";

        this.cmisSession = cmis.createSession(proxyUrl);
        this.cmisSession.setGlobalHandlers(
            this.onCmisError.bind(this),
            this.onCmisError.bind(this)
        );
        this.cmisSession.setCharacterSet(document.characterSet);
    }

    get dynamicProps() {
        return {
            list: this.this.state.cmisObjectsWrap || [],
            deleteObject: this.deleteObject.bind(this.this),
            renameObject: this.renameObject.bind(this.this),
            updateDocumentContent: this.updateDocumentContent.bind(this.this),
            openInAlf: this.open,
        };
    }

    sortBy(fieldName) {
      const current = (this.state.orderBy || [])[0];
      const asc = !(current && current.name === fieldName && current.asc);

      this.state.orderBy = [{ name: fieldName, asc }];

      const arr = [...(this.state.cmisObjectsWrap || [])];
      arr.sort((a, b) => {
        const va = (a.columnMapper?.[fieldName] ?? a[fieldName] ?? "").toString();
        const vb = (b.columnMapper?.[fieldName] ?? b[fieldName] ?? "").toString();
        return asc ? va.localeCompare(vb) : vb.localeCompare(va);
      });
      this.state.cmisObjectsWrap = arr;
    }

    async setRootFolderId() {
        console.log(this.rootFolderId);
        if (this.rootFolderId === this.state.value.cmis_folder) {
            return;
        }
        this.rootFolderId = this.state.value.cmis_folder;
        if (!this.rootFolderId) {
            return;
        }
        if (!this.cmisSession) {
            this.initCmisSession();
        }
        try {
            if (!this.cmisSession.repositories) {
                await new Promise((resolve, reject) => {
                    this.cmisSession
                        .loadRepositories()
                        .ok(resolve)
                        .notOk(reject);
                });
            }
            this.state.parentFolders = [];
            this.displayFolder({name: "Root", id: this.rootFolderId});
        } catch (error) {
            this.onCmisError(error);
        }


    }

    getCmisObjectWrapperParams() {
        return {};
    }

    async queryCmisData() {
        if (!this.displayFolderId) {
            return;
        }
        const options = {
            includeAllowableActions: true,
            renditionFilter: "application/pdf",
        };
        let cmisObjectsData;
        try {
            if (!this.cmisSession) {
                this.initCmisSession();
            }
            cmisObjectsData = await new Promise((resolve, reject) => {
                this.cmisSession
                    .getChildren(this.displayFolderId, options)
                    .ok(resolve)
                    .notOk(reject);
            });
            const params = this.getCmisObjectWrapperParams();
            this.state.cmisObjectsWrap = this.cmisObjectWrapperService.wrap(
                cmisObjectsData.objects,
                this.cmisSession,
                params
            );
        } catch (e) {
            this.onCmisError(e);
        }
    }


    async displayFolder(folder) {
        if (this.displayFolderId === folder.id) {
            return;
        }
        this.displayFolderId = folder.id;
        if (!this.cmisSession) {
            this.initCmisSession();
        }
        try {
            const cmisFolderData = await new Promise((resolve, reject) => {
                this.cmisSession
                    .getObject(this.displayFolderId, "latest", {includeAllowableActions: true})
                    .ok(resolve)
                    .notOk(reject);
            });
            this.state.allowableActions = cmisFolderData.allowableActions;
            this.queryCmisData();
            this.updateParentFolders(folder);
        } catch (e) {
            this.onCmisError(e);
        }

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
            res_id: this.props.record.evalContext.id,
            field_name: this.props.name,
        });
        await this.props.record.load();
        this.props.record.model.notify();
        this.state.value = cmisFolderValue.value;
    }

    onCmisError(error) {
        if (error) {
            console.log(error.body?.message || 'No message');
            // this.orm.call("dialog", "add", WarningDialog, {
            //     title: "CMIS Error",
            //     message: error.body.message,
            // });
        }
    }

    uploadFiles(files) {
        var self = this;
        var numFiles = files.length;
        const processedFiles = [];
        // if (numFiles > 0) {
        //     this.blockUI();
        // }
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
                        // this.unblockUI();
                    }
                })
                .notOk(function (error) {
                    if (error) {
                        self.onCmisError(error);
                        // this.unblockUI();
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
            // this.unblockUI();
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
        backend_cmis: fieldInfo.options?.backend_cmis ?? fieldInfo.backend_cmis,
        allowCreate: fieldInfo.options?.allow_create ?? fieldInfo.allow_create,
    }),

};


CmisFolderField.template = "cmis_web.CmisFolderField";
CmisFolderField.supportedTypes = ["cmis_folder"];

CmisFolderField.extractProps = ({ field }) => {
    return {
        backend_cmis: field.backend_cmis,
        allowCreate: field.allow_create,
    };
};

registry.category("fields").add("cmis_folder", CmisFolderFieldComponent);
